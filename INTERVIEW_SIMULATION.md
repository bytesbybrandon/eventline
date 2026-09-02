# System Design Interview Simulation: Rate Limiter

A live walkthrough showing how the DSL guides a complete interview, from functional reqs through architecture.

---

## Setup

**Interviewer:** "Design a rate limiter for our API platform. Here's the context:

- 50,000 RPS at peak
- 10,000 concurrent users
- User tiers: free (100 req/min), pro (1000 req/min)
- P99 latency < 2ms for rate-limit decision
- 99.99% uptime SLA
- Multi-region (3 regions, US primary)"

---

## Step 1: Commands & Events (Functional Requirements)

### Interviewee

> "OK, so the core flow is: user makes a request, I check if they're under their limit, and either allow or reject. Let me write the command first."

```text
user -> makeRequest(resourceId)
on [
  user-authenticated(userId),
  request-logged*(userId, window: 1m)
]
from [
  UserTierCache(userId) @fresh<24h> as tier
]
  --[request-count < tier.limit]--> [
    request-logged {
      userId,
      resourceId,
      requestAt: clock.wall(),
      requestMinute: window.floor(clock.wall(), 1m)
    }
  ]
  --[request-count >= tier.limit]--> [
    rate-limit-exceeded { userId, resourceId, retryAfter: 60s }
  ]
```

> "I'm using a 1-minute window because it's simple and matches the limits they gave me (100/min, 1000/min). I log the request first in the happy path so it's atomic."

### Interviewer

> "Good start. Two things:
>
> 1. You're checking `request-logged*` as a given fact — that means you're querying all requests in the 1m window to count them. How do you handle the fact that requests might still be coming in while you're reading? Race condition?"

### Interviewee

> "Oh, right. The `*` means zero or more, so I'm loading all historical requests in this window. But you're right — if two requests come in simultaneously, they might both read count=0 and both slip through.
>
> That's why I need to bind this to a consistency boundary. Let me add that in Step 2. For now, assume the count is accurate within the boundary."

### Interviewer

> "OK, makes sense. Second thing: what if the user is *exactly* at the limit? On request N, count is N-1, so they pass. But what about request N+1 one millisecond later?"
>
> Also: you put `UserTierCache` in `from [...]`, separate from `on [...]`. Why? Isn't it just another precondition?"

### Interviewee

> "Ah, I see the edge case. The second request would see count=N (because the first one was logged), so it gets rejected. So the limit is `<`, not `<=`. That's correct — they get exactly N requests per window, then get rejected on N+1."
>
> And for `UserTierCache`: that's not an event. It's a view - a cached projection from tier assignment events. I keep it in `from [...]` because it is a read-model lookup, not causal history."

### Interviewer

> "Perfect. And one more: you're logging the request in the success path, but not in the failure path. Is that intentional?"

### Interviewee

> "Yes. If I reject them, I don't count it against their quota — they can retry. The `rate-limit-exceeded` event is just a signal that this request was denied. I only count *accepted* requests."

### Interviewer

> "Reasonable. Let's move to Step 2."

---

## Step 2: Boundaries (Scale Math → Partitioning)

### Interviewer

> "Now: you said 50k RPS and 1-minute window. Every request touches `request-logged*`. How many total events are in memory at any given time?"

### Interviewee

> "Let's see: 50k RPS × 60 seconds = 3 million events in a 1-minute window. Each event is maybe 100 bytes, so 300MB just for request logs. Plus tier projections, plus other metadata... that's getting big."

### Interviewer

> "Exactly. So if you don't partition, you have a global hot spot. What's your partition strategy?"

### Interviewee

> "By user. Each user has their own quota bucket scoped to their user ID. So the boundary is the combination of `userId` + `currentMinute`. I shard the data by userId so user A's quota is on shard 1, user B is on shard 2, etc."

### Interviewer

> "Good. And how many shards do you need?"

### Interviewee

> "10,000 concurrent users, so at least 10k shards? Or maybe 100k to leave headroom for growth and avoid hot spots."

### Interviewer

> "What if one user is making 10,000 RPS themselves?"

### Interviewee

> *(pauses)*
> "Oh. Then all 10k of their requests hit the same shard, and that shard becomes a bottleneck. That's a problem.
>
> I could add a second dimension to the partition: maybe `userId` + `IP` + `window`? But then I'm partitioning by IP, which users can spoof or rotate through proxies.
>
> Or... I could just accept that a single power user hits a single shard and that shard needs to be fast. The shard handles 10k RPS locally. Can it?"

### Interviewer

> "Can it?"

### Interviewee

> "If it's in-memory and I'm just incrementing a counter, yeah. 10k increments per second in RAM is totally doable."

### Interviewer

> "OK so your boundary is...?"

### Interviewee

> *(writes)*
>
> ```text
> boundary UserRateLimit(userId, currentMinute) 
>   @partition(shardKey="userId", fanout=100000)
>   @leader("primary-region")
> ```
>
> Each shard handles one user for one minute window. The fanout is 100k to avoid hot spots. And for now, I'm saying the leader shard is in the primary region — so all writes go there."

### Interviewer

> "Good. But hold on: you said multi-region. How do replicas work? If US primary fails, does your rate limiter fail?"

### Interviewee

> *(thinks)*
>
> "Hmm. If I replicate synchronously (wait for US + EU to confirm), I add latency — probably violates the 2ms SLA.
>
> If I replicate asynchronously, then a user in EU might get stale count data and slip more requests through than they should.
>
> Or... I could let each region maintain its own independent quota. User A in EU gets 100/min EU-local, plus 100/min US. So 200/min total across regions. But that's confusing and breaks the SLA model."

### Interviewer

> "What's your call?"

### Interviewee

> "For now: async replication with a write-through cache. Requests go to the primary shard, update happens, then we replicate to secondary regions. If primary fails, clients in secondary regions might double-count for a few seconds, but we prioritize latency < 2ms over perfect consistency.
>
> In the policy layer, I can add abuse detection to catch egregious over-counts."

### Interviewer

> "Fair. Next step."

---

## Step 3: Views & Caching (Latency Budget → Storage)

### Interviewer

> "P99 latency < 2ms. Your decider needs to:
>
> 1. Fetch user-tier info
> 2. Fetch all requests in the 1m window (to count them)
> 3. Append the new request event
> 4. Return the result
>
> How do you stay under 2ms?"

### Interviewee

> *(thinks)*
>
> "Network latency alone is ~1ms to a database in the same region. So I can't go to disk.
>
> User-tier probably changes rarely (daily at most), so I cache it. For request counts, I need a fast in-memory data structure."

### Interviewer

> "What data structure?"

### Interviewee

> "A sliding-window counter in memory. For each user+minute, keep a counter. Increment on each request. When the window rolls, reset.
>
> Actually, wait. If I'm partitioning by userId, then each shard stores its own counter. So shard-1 has all counters for user-1 across all their windows.
>
> On each request, I:
>
> 1. Hash userId to shard
> 2. Look up the counter for (userId, currentMinute) in that shard (O(1) dict lookup)
> 3. Increment it
> 4. Return the new count
>
> All in RAM, no I/O. Should be sub-millisecond."

### Interviewer

> "But wait: when the minute changes (e.g., 10:00 to 10:01), how do you reset the counter?"

### Interviewee

> *(pauses)*
>
> "If I have a shard tracking user-1's requests, when the minute rolls, I need to:
>
> - Keep the 10:00 bucket (for audit/analytics)
> - Clear the 10:01 bucket (or create it fresh)
>
> If I do this lazily (clear on first request after 10:01), then the first request in the new window might see leftover count from the old window.
>
> If I do it eagerly (sweep the shard every minute), that's fine but adds complexity."

### Interviewer

> "How would you structure the view to avoid this?"

### Interviewee

> *(rewrites)*
>
> ```text
> view UserQuotaWindow(userId, minute) = [
>   tier-assigned*(userId, tier),
>   request-logged*(userId, minute)
> ] => {
>   count,
>   tier,
>   remaining,
>   windowStart,
>   windowEnd
> } @bergcache(key="quota:{userId}:{minute}", ttl=60s)
>   @time(window="fixed:1m", source="clock.wall")
>   @cost(memory="~6MB/region", cpu="O(1) per hit")
> ```
>
> "Each (user, minute) pair gets its own cache entry. Entries expire after 60s (one window duration). So 10:00's entry expires at 10:01:00, and 10:01's entry is fresh.
>
> This view is what we read in the `from [...]` clause of the command. It's derived from events, not an event itself."

### Interviewer

> "Better. But now: how much memory does this take?"

### Interviewee

> "Each entry is ~200 bytes. 50k RPS × 60s = 3M requests per window. If each request adds a new (userId, minute) entry...
>
> Actually, no. Multiple requests from the same user in the same minute reuse the same view entry. So unique (userId, minute) pairs = unique users × # of windows we keep.
>
> 10k concurrent users × (maybe 2-3 windows in flight, since requests span windows) = ~30k entries.
> 30k × 200 bytes = 6MB. Very manageable."

### Interviewer

> "Great. And you're hitting this cache on every request?"

### Interviewee

> "Yes. Cache hit = O(1) in-memory lookup. Cache miss = compute from events, populate cache. But since most requests from a user come in the same minute, cache hit rate should be very high."

### Interviewer

> "Good. Write it up."

### Interviewee

> ```text
> view UserQuotaWindow(userId, currentMinute) = [
>   tier-assigned*(userId, tier),
>   request-logged*(userId, currentMinute)
> ] => {
>   tier,
>   count,
>   remaining: tier.limit - count,
>   windowStart: currentMinute,
>   windowEnd: currentMinute + 60s
> } @bergcache(
>   key="quota:{userId}:{currentMinute}",
>   ttl=60s,
>   ram_estimate="6MB per region"
> )
>   @time(window="fixed:1m", source="clock.wall")
>   @cost(memory="~6MB/region", cpu="O(1) per hit")
> ```

---

## Step 4: Policies & Resilience (SLA → Automation)

### Interviewer

> "Now: 99.99% uptime. Four nines. That's ~44 seconds of downtime per month.
>
> What happens if your rate-limit shard goes down? Do all requests from that user get rejected? Get through unchecked?"

### Interviewee

> "If the shard is down, I can't check the quota. Options:
>
> 1. Fail-safe (assume they're under quota, let them through) — risk of abuse
> 2. Fail-closed (reject everything) — broken user experience
> 3. Use a fallback (last-known quota cached upstream) — tricky
>
> For 99.99% uptime, I need the shard itself to be highly available."

### Interviewer

> "How?"

### Interviewee

> "Replicate the shard. Primary in US, secondary in EU. If primary fails, promote secondary. Replication is async, so a few requests might sneak through, but we accept that."

### Interviewer

> "And the promotion? How long does that take?"

### Interviewee

> "Depends on detection and failover automation. Ideally < 30 seconds. But during that window, the shard is unavailable.
>
> During failover, I could have a policy: if the shard is unreachable, use a cached quota value from the last 5 minutes. So user gets a slightly stale count, but keeps functioning."

### Interviewer

> "Write the policy."

### Interviewee

> ```text
> shard-unavailability-detected { userId, shard_id }
>   --[detection_time > 30s]--> failover-controller -> promoteSecondary(shard_id)
>
> unavailable-shard-request-received { userId }
>   --[staleCacheAvailable]--> [
>     request-logged {
>       userId,
>       resourceId,
>       requestAt: clock.wall(),
>       requestMinute: window.floor(clock.wall(), 1m)
>     } @confidence(level="low", reason="stale_quota", asOf="5m ago")
>   ]
>   --[default]--> [
>     unavailable-shard-error-returned { userId, shard_id, retryAfter: 5s }
>   ]
> ```

### Interviewer

> "And abuse detection? If a bunch of requests slip through during failover, how do you catch it?"

### Interviewee

> ```text
> request-logged { userId }
>   --[scoreBy("quota-anomaly-v2", userId) > 0.8]--> fraud-detector -> [
>     quota-anomaly-detected {
>       userId,
>       score,
>       model: "quota-anomaly-v2",
>       source: "failover"
>     }
>   ]
>
> quota-anomaly-detected { userId, score, model }
>   --[score > 0.8]--> waf-svc -> applyTemporaryBlock(userId, duration: 5m)
> ```

---

## Full DSL Specification (Complete)

```text
// ============================================
// RATE LIMITER: Complete System Design DSL
// ============================================

// 1. BOUNDARIES & PARTITIONING (Step 2: Scale Math)
boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId", fanout=100000)
  @leader("primary-region", failover="secondary-region")
  @replication(mode="async", lag_sla="<5s")
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
  @cost(regions=3, shardFanout=100000, writeRpsPeak=50000)
  @ops(owner="traffic-platform", slo="99.99%", alert="rate-limit-shard-unavailable")


// 2. COMMANDS & EVENTS (Step 1: Functional Reqs)

// Authentication (prerequisite)
user -> authenticate(email, password)
on [user-created(email)]
  --[credentials_valid]--> [
    user-authenticated { userId, email, tier, authenticatedAt: clock.wall() }
  ]
  --[!credentials_valid]--> [
    auth-login-failed { email, reason: "invalid_credentials" }
  ]


// Rate Limiter Decider (hot path)
user -> makeRequest(resourceId)
on [
  user-authenticated(userId),
  request-logged*(userId, currentMinute)
]
from [
  UserTierCache(userId) @fresh<24h> as tier
]
  --[count < tier.limit]--> [
    request-logged {
      userId,
      resourceId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    }
  ]
  --[count >= tier.limit]--> [
    rate-limit-exceeded {
      userId,
      resourceId,
      limit: tier.limit,
      retryAfter: window.end(currentMinute, 1m) - clock.wall()
    }
  ]


// 3. VIEWS & CACHING (Step 3: Latency Budget → Storage)

view UserQuotaWindow(userId, currentMinute) = [
  tier-assigned*(userId, tier),
  request-logged*(userId, currentMinute)
] => {
  tier,
  count,
  remaining: tier.limit - count,
  windowStart: currentMinute,
  windowEnd: currentMinute + 60s,
  staleAt: "5m"
} @bergcache(
  key="quota:{userId}:{currentMinute}",
  ttl=60s,
  ram_estimate="6MB per region",
  read_latency_p99="<1ms"
)
  @time(window="fixed:1m", source="clock.wall")
  @cost(memory="~6MB/region", readRpsPeak=50000)
  @ops(owner="edge-runtime", dashboard="quota-window-overview")

view UserTierCache(userId) = [
  tier-assigned(userId, tier)
] => {
  tier,
  limit,
  updatedAt
} @bergcache(
  key="tier:{userId}",
  ttl=24h,
  ram_estimate="<1MB"
)
  @cost(memory="<1MB/region")
  @ops(owner="billing-platform")


// 4. POLICIES & RESILIENCE (Step 4: SLA → Automation)

// Failover: detect shard unavailability
shard-availability-probed { shard_id }
  --[probe_fails > 3_in_a_row]--> failover-controller -> promoteSecondary(shard_id)

// Fallback: stale quota on shard failure
shard-unavailability-detected { userId, shard_id }
  -> failover-controller -> routeToSecondary(shard_id)

unavailable-shard-request-received { userId, shard_id }
  --[staleCacheExists && staleCacheAge < 5m]--> [
    request-logged {
      userId,
      resourceId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    } @confidence(level="low", reason="stale_quota", asOf=cache.timestamp)
  ]
  --[default]--> [
    unavailable-shard-error-returned { userId, shard_id, retryAfter: 5s }
  ]

// Abuse detection: catch over-counts during failover
request-logged { userId, count }
  --[scoreBy("quota-anomaly-v2", userId) > 0.7]--> [
    quota-anomaly-detected {
      userId,
      score,
      model: "quota-anomaly-v2",
      source: "potential-failover"
    }
  ]

// Block suspicious users
quota-anomaly-detected { userId, score, model }
  --[score > 0.7]--> waf-svc -> temporaryBlock(userId, duration: 5m)

// Analytics: tail call
request-logged { userId }
  -> analytics-worker -> incrementDailyMetrics(userId, minute: currentMinute)

@ops(
  runbook="runbooks/rate-limit-failover.md",
  alerts=["rate-limit-shard-unavailable", "quota-anomaly-spike"],
  traces=["makeRequest", "quota-anomaly-detected"]
)
```

---

## Syntax Refinement: Events vs Views (on vs from)

During this walkthrough, the team identified a critical ambiguity: **the original syntax mixed events and views in a single `on [...]` clause without declaring which was which.**

### The Problem

```text
// Old (ambiguous):
user -> makeRequest(resourceId) on [
  user-authenticated(userId),  ← is this an event or a projection?
  user-tier(userId, tier),     ← definitely a view, but syntax hides it
  request-logged*(userId, min) ← event with temporal window
]
```

This conflates:
- **Causal events** (what happened in the past)
- **Current facts** (projections and cached values)
- **Temporal windows** (historical aggregation)

All in one list with no way for a reader to distinguish them. A command looks authoritative even when it's reading stale cache.

### The Solution: Separate Clauses

```text
// New (explicit):
user -> makeRequest(resourceId)
on [
  user-authenticated(userId),       ← only events go here
  request-logged*(userId, minute)   ← temporal event streams
]
from [
  UserTierCache(userId) as tier     ← only views/projections
]
```

**Semantics:**
- `on [...]`: events only. Causal history, must-have-happened facts, event windows.
- `from [...]`: views only. Read-model lookups, projections, cached values with stated freshness.

**Why this matters:**
- A reader instantly knows which data is authoritative (events) vs optimized (views).
- Runtime can attach different consistency contracts: `on` = "event-consistent within boundary", `from` = "projection with X staleness".
- Candidates naturally think this way in interviews: "what events must have happened?" then "what current state do I need?"

**Impact on the DSL:**
- All command examples in this simulation have been updated to use explicit `on/from`.
- Linters can now validate: events in `on`, views in `from`, no mixing.
- Freshness policies can be declared on view references if needed: `from [ UserTierCache(userId) @fresh<60s> as tier ]`.

## Event Naming Rule

All events follow this shape:

`{aggregate}[-fragments]*-{verb}`

Examples:
- `payment-applied`
- `package-delivery-stalled`
- `request-logged`
- `unavailable-shard-error-returned`

---

## Reflection: What Felt Off?

### Status Snapshot

- Resolved: mixed event/view preconditions by separating `on [...]` and `from [...]`.
- Resolved: event naming consistency using `{aggregate}[-fragments]*-{verb}`.
- Resolved: removed view-as-source drift from quota projection examples.
- Resolved: confidence metadata on fallback writes (`@confidence(level=...)`).
- Resolved: anomaly scoring references explicit model scoring (`scoreBy("quota-anomaly-v2", ...)`).
- Resolved: derived fields moved out of primary request event payload.
- Resolved: formal time primitives (`clock.wall`, `window.floor`, `window.end`).
- Resolved: cost and operations metadata (`@cost`, `@ops`) on hot paths.

### ✅ What Worked Well

- **Step 1 (Commands):** Easy to express the core logic. The `--[guard]-->` format made branch decisions clear.
- **Step 2 (Boundaries):** Partitioning strategy was obvious once scale math came up. The DSL forced the question "what's your shard key?"
- **Step 3 (Caching):** Separating reads (views) from writes (commands) made storage strategy explicit. The `@bergcache` annotation tied latency SLA to storage choice.
- **Step 4 (Policies):** Failover and abuse detection were naturally policy-shaped (event-driven reactions).
- **on vs from separation:** Mixing events and views was the single biggest source of confusion. Splitting them eliminated all ambiguity in command preconditions.

### Resolved Awkwardness

1. **Stale-cache ambiguity:** Resolved by attaching `@confidence(level=..., reason=..., asOf=...)` to fallback emissions instead of creating duplicate event names.
2. **Anomaly scoring realism:** Resolved by explicit model-scored guards such as `scoreBy("quota-anomaly-v2", userId)` and carrying `score` and `model` in emitted events.
3. **Event payload overload:** Resolved by keeping `request-logged` focused on primary facts and moving derived values (`count`, `remaining`) into projections.
4. **Time ambiguity:** Resolved with explicit time primitives and annotations: `clock.wall()`, `window.floor(...)`, `window.end(...)`, and `@time(...)`.

### Remaining Gaps

1. **Consistency quantification:** We still do not force explicit worst-case math for async replication (for example over-quota leak bounds during failover windows).
2. **Policy calibration process:** Confidence thresholds and model cutoffs are represented, but environment-specific calibration workflow is not formalized in DSL yet.
3. **Operational maturity depth:** `@ops(...)` captures ownership and runbooks, but rollout strategy and change-management policies remain conventions rather than first-class grammar.

---

## Revisit Opportunities

If you're using this DSL in a real interview, flag these spots:

1. **After Step 1:** "Which preconditions are event facts (`on`) versus view facts (`from`), and what freshness do your view reads require?"
2. **After Step 2:** "If a shard goes down, how do you detect it? How fast can you failover?" (This naturally leads to policies in Step 4.)
3. **After Step 3:** "At 50k RPS, your cache gets ~3M events per minute. How do you evict? What's your LRU/TTL strategy?" (Pushes on memory management.)
4. **After Step 4:** "You have a fallback to stale quota. Quantify the risk: how many users will over-quota during a failover? How long until you detect it?" (Ties policies back to SLA.)

---

## Next Steps

- Add lint rules for event naming, `on`/`from` type checks, and required metadata on fallback paths?
- Calibrate confidence thresholds and anomaly model versions per environment?
- Define a small standard library for time helpers (`clock.*`, `window.*`) to keep implementations portable?
