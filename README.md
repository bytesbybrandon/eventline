# System Design DSL: Event Modeling & Interview Playbook

A clean, high-speed specification notation based on Event Modeling (`eventmodeling.org`).
Focuses on the event model over time (Commands, Events, Projections, Sagas) rather than static class hierarchies or aggregate objects.

---

## 1. Event Model vs Domain Model in System Design

In classical system design interviews, candidates often get bogged down in static "Domain Models" (class diagrams, ER diagrams, aggregate boundaries, tables).

An **Event Model (`eventmodeling.org`)** is fundamentally superior for system design:

1. **Focus on Timeline & State Over Time:** Models how data changes across commands and events, not static snapshots.
2. **Pure Deciders & Invariants:** Replaces vague service logic with pure functions `(Given State, Command) -> [New Events]`.
3. **Explicit Concurrency & Partitions:** Dynamic Consistency Boundaries (DCB) scope transactions via keys (`userId`, `window`) instead of global locks.
4. **Guaranteed CQRS:** Read models are deterministic projections from events, making caching and query optimization trivial to reason about.

---

## 2. The Interview Delivery Script

Never introduce it as an academic DSL.
Frame it naturally as a structured event model:

> *"Before drawing infrastructure boxes, I like to write a quick event model to nail down our state transitions, business invariants, concurrency boundaries, and read projections."*

---

## 3. Core Grammar: The 4 Primitives

Every system design problem decomposes into four fundamental building blocks.

### Primitive 1: Commands (Deciders / State Transitions)

A command expresses caller intent.
A pure decider queries past domain facts within a consistency boundary, checks invariants via guards, and commits zero or more new domain events.
Use `--[default]-->` for the final happy-path branch.

```text
Actor -> Command(Args) in Boundary(key)
on [Given Events(filter)]
from [Given Views(key) as alias]
--[Guard1]--> [Events1]
--[default]--> [HappyPathEvents]
```

**Event Naming Rule:**

Events use this shape:

```text
{aggregate}[-fragments]*-{verb}
```

Examples:

- `payment-applied`
- `package-delivery-stalled`
- `request-logged`
- `rate-limit-reached`

**Guard Rules:**

- **Guard as Transition:** Put the predicate on the edge, not as a detached statement block (`--[count > limit]-->`).
- **Explicit Fallback:** Use `--[default]-->` for the final happy path. Never leave a branch implicit.
- **Multi-Condition Guards:** Use comma-separated conditions inside the guard: `--[count > limit, $tenant_id:xyz]-->`.

**Example:**

```text
user -> makeRequest(resourceId)
on [user-authenticated(userId), request-logged*(userId, window: 60s)]
from [UserTierCache(userId) as tier]
  --[!canAccessResource]--> [
    request-failed { userId, resourceId, reason: "unauthorized" }
  ]
  --[count(request-logged) >= tier.limit]--> [
    rate-limit-reached { userId, resourceId, retryAfter: 60s }
  ]
  --[default]--> [
    request-logged {
      userId,
      resourceId,
      requestMinute: window.floor(clock.wall(), 60s),
      requestAt: clock.wall()
    }
  ]
```

---

### Primitive 2: Views (Read Models / Projections)

A deterministic view projected from domain events.
Annotated with storage engine, partition key, and cache TTL.

```text
view ViewName(Key) = [Source Events(Key)] => { State Shape } @StorageAnnotation
```

**Example:**

```text
view UserQuota(userId) = [user-authenticated(userId), request-logged*(userId)] => {
  tier,
  remainingRequests,
  resetsIn
} @cache(key="quota:{userId}", ttl=60s)
```

---

### Primitive 3: Policies (Reactors / Sagas / Automations)

An event-driven trigger.
When a domain event occurs, an asynchronous worker or service reacts by evaluating a guard and then emitting the next step in the event flow.

A policy may emit either a command or a domain event. In most operational workflows, the policy resolves to a command, which then becomes the next decider input.

```text
event-name { payload }
--[Guard]--> Worker/Service -> NextCommand()
```

The DSL also supports explicit model and confidence semantics in event metadata:

```text
event-name { payload } @confidence(level="low", reason="stale_read")
event-name { payload } --[scoreBy("model-v1", key) > 0.8]--> [next-event]
```

**Example:**

```text
rate-limit-reached { userId }
--[violationsLastHour > 50]--> waf-bot -> applyTemporaryBan(userId, duration=15m)
```

---

### Primitive 4: Boundaries (DCB Sharding & Partitioning)

Defines the dynamic consistency boundary and partition strategy without rigid aggregate roots.
A command states the boundary it decides in with `in BoundaryName(key)` after its parameters, which is what lets tools bracket it on a diagram.

```text
boundary BoundaryName(userId, window) @partition(shardKey="userId")
```

Boundary metadata can formalize time model, cost, and operations:

```text
boundary BoundaryName(userId, window)
  @partition(shardKey="userId")
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
  @cost(regions=3, shardFanout=100000, writeRpsPeak=50000)
  @ops(owner="team-name", slo="99.99%", alert="boundary-unavailable")
```

**Example:**

```text
boundary UserRateLimit(userId, currentMinute) @partition(shardKey="userId")
```

---

## 4. 1:1 Mapping to Event Modeling (`eventmodeling.org`)

This DSL completely covers all four canonical slice patterns from Event Modeling:

| Event Modeling Pattern       | Color Code                                        | DSL Representation                                | Architectural Role                                |
| :--------------------------- | :------------------------------------------------ | :------------------------------------------------ | :------------------------------------------------ |
| **State Change Slice** | Blue$\rightarrow$ Orange                        | `Actor -> Command() on [Events*] from [Views*] -> [Events]` | Authoritative write path & invariant enforcement  |
| **State View Slice**   | Orange$\rightarrow$ Green                       | `view ViewName = [Events*] => { State } @cache` | Query optimization, caching, and read projections |
| **Automation Slice**   | Orange$\rightarrow$ Purple $\rightarrow$ Blue | `event --[Guard]--> worker -> Command()`        | Background sagas, event-driven workflows          |
| **Translation Slice**  | External$\leftrightarrow$ Domain                | `webhook -> adapter -> Command() -> [Event]`    | Inbound webhook ingest & outbound API push        |

---

## 5. The 4-Step Interview Transition Framework

```
[System Context] --> Step 0: Actors & External Dependencies
[Functional Reqs]  -->  Step 1: Commands & Events (Event Model)
[Scale Math / QPS] -->  Step 2: Tag Boundaries (DCB Partitioning)
[Latency Budgets]  -->  Step 3: Views & Storage Annotations (Hot Caches)
[Availability SLA] -->  Step 4: Policies & Sagas (Async Offloading)
```

## 5a. Actors & System Context (Step 0)

Before modeling commands, declare your actors and system context.

**Actors** are the people, services, and systems that interact with your domain. See [ACTORS.md](./ACTORS.md).

**System Context** is the top-level block that names external dependencies, global SLAs, regions, and data classification. See [SYSTEM-CONTEXT.md](./SYSTEM-CONTEXT.md).

These declarations make the "who can do what" and "what happens if X fails" questions impossible to ignore.

---

## 6. Complete Interview Case Study: Rate Limiter

```text
// 0. Actors & System Context
system RateLimiterAPI {
  external: stripe (payment-gateway), sentry (monitoring)
  slo: 99.99% uptime, p99 < 2ms
  region: us-primary, eu-secondary
  data-classification: pii
}

actor User { auth: session, tier: free|pro }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }

// 1. Concurrency Boundary
boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId")
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
  @cost(regions=3, shardFanout=100000, writeRpsPeak=50000)
  @ops(owner="traffic-platform", slo="99.99%", alert="rate-limit-shard-unavailable")

// 2. Authentication Decider
user -> authenticate(email, password, ip)
on [user-created(email)]
  --[invalidCredentials]--> [
    user-auth-failed { email, ip, reason: "bad_password" }
  ]
  --[default]--> [
    user-auth-succeeded { userId, ip, tierId }
  ]

// 3. Tier Limit Projection
view TierLimit(tierId) = [
  tier-created(tierId),
  tier-limit-increased*(tierId),
  tier-limit-decreased*(tierId)
] => {
  tierId,
  limit
} @cache(key="tier:{tierId}:limit", ttl=24h)

// 4. Rate Limiter Decider
user -> makeRequest(resourceId) in UserRateLimit(userId, currentMinute)
on [
  user-auth-succeeded(userId, tierId),
  request-logged*(userId, window: currentMinute)
]
from [
  TierLimit(tierId) @fresh<24h> as tierLimit
]
  --[!canAccessResource]--> [
    request-failed { userId, resourceId, reason: "unauthorized" }
  ]
  --[count(request-logged) >= tierLimit.limit]--> [
    rate-limit-reached { userId, resourceId, retryAfter: 60s }
  ]
  --[default]--> [
    request-logged {
      userId,
      resourceId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    }
  ]

// 5. In-Memory Read View (O(1) in memory)
view UserQuota(userId) = [user-auth-succeeded(userId), request-logged*(userId)] => {
  tierId,
  remainingRequests,
  resetsIn
} @cache(key="quota:{userId}", ttl=60s)
  @cost(memory="~6MB/region", readRpsPeak=50000)
  @ops(owner="edge-runtime", dashboard="quota-window-overview")

// 6. Abuse Defense Policy (Decoupled from hot path)
rate-limit-reached { userId }
--[violationsLastHour > 50]--> waf-bot -> applyTemporaryBan(userId, duration=15m)

// 7. Stale-read fallback with confidence metadata
unavailable-shard-request-received { userId, shardId }
  --[staleCacheExists]--> [
    request-logged {
      userId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    } @confidence(level="low", reason="stale_quota", asOf=cache.timestamp)
  ]
```

---

## 7. DSL Validation Checklist

Use this quick pass before you call a model complete.

1. Event naming: every event matches `{aggregate}[-fragments]*-{verb}`.
2. Command inputs: `on [...]` includes only event facts.
3. Read dependencies: `from [...]` includes only view facts.
4. Freshness: each critical `from [...]` read has explicit freshness/consistency intent.
5. Confidence: fallback or stale-driven outputs encode confidence metadata (`@confidence(...)`).
6. Model guards: scored decisions reference explicit model/version (`scoreBy("model", ...)`).
7. Guards: all branches use `--[guard]-->` and include `--[default]-->` when needed.
8. Projection sources: views are projected from events, not from other views.
9. Boundary clarity: each hot-path command states its partition key and consistency boundary with `in BoundaryName(key)`.
10. Policy coverage: failure/abuse/failover reactions are expressed as policies.
11. Time semantics: window terms (`currentMinute`, `clock.wall()`, `window.end(...)`) are defined.
12. Cost and ops: capacity, replication risk, owners, alerts, and runbook hooks are called out.

---

## 8. Normative Extension Grammar

Use this section as parser-level reference for extension syntax.

```text
// Core
command = actor "->" verb "(" params ")"
          [ "in" boundary_name "(" key ")" ]
          [ "on" "[" event_facts "]" ]
          [ "from" "[" view_facts "]" ]
          branch+

branch = "--[" guard "]-->" "[" emitted_events "]"

event_fact = event_name "(" params ")"
           | event_name "*" "(" params ")"

view_fact = view_name "(" params ")"
          [ freshness ]
          [ "as" alias ]

freshness = "@fresh<" duration ">"
          | "@eventual"
          | "@strong"

// Extension metadata
event_emission = event_name "{" fields "}" [ confidence ]

confidence = "@confidence(" confidence_fields ")"
confidence_fields = "level=\"" ("high"|"medium"|"low") "\""
                    [ ",reason=\"" text "\"" ]
                    [ ",asOf=" time_expr ]

time_annotation = "@time(" time_fields ")"
time_fields = "window=\"" text "\""
              ",source=\"" ("clock.wall"|"clock.event"|"clock.ingest") "\""
              [ ",clockSkewBudget=\"" duration "\"" ]

cost_annotation = "@cost(" key_values ")"
ops_annotation  = "@ops(" key_values ")"

time_expr = "clock.wall()"
          | "window.floor(" time_expr "," duration ")"
          | "window.end(" bucket "," duration ")"
```

Normative rules:

1. `on [...]` MUST contain only event facts.
2. `from [...]` MUST contain only view facts.
3. Event names MUST match `{aggregate}[-fragments]*-{verb}`.
4. `@confidence(...)` MUST be attached to an event emission, not a command.
5. `@time(...)` SHOULD be declared on a boundary when a windowed guard exists.
6. If a fallback path uses stale reads, emitted events SHOULD include `@confidence(...)`.
7. `@cost(...)` and `@ops(...)` MAY appear on boundaries, views, and policies.

---

## 9. Worked Scenario: Payment Capture Webhook (Non-Rate-Limiter)

This scenario proves the extensions generalize outside traffic control.

```text
// 1. Boundary with explicit time/cost/ops
boundary InvoicePayment(invoiceId)
  @partition(shardKey="invoiceId")
  @time(window="fixed:24h", source="clock.wall", clockSkewBudget="<500ms")
  @cost(regions=2, writeRpsPeak=5000)
  @ops(owner="billing-platform", slo="99.95%", alert="payment-webhook-delay")

// 2. Translation slice: external webhook -> command
stripe-webhook -> ingestCharge(invoiceId, stripeEventId, amount) in InvoicePayment(invoiceId)
on [invoice-issued(invoiceId)]
from [
  PaymentStatusView(invoiceId) @fresh<10s> as paymentStatus,
  WebhookDedupView(stripeEventId) @fresh<24h> as dedup
]
  --[dedup.seen == true]--> [
    webhook-duplicate-ignored { invoiceId, stripeEventId, receivedAt: clock.wall() }
  ]
  --[paymentStatus.state == "captured"]--> [
    payment-already-captured { invoiceId, stripeEventId, receivedAt: clock.wall() }
  ]
  --[default]--> [
    payment-captured {
      invoiceId,
      stripeEventId,
      amount,
      capturedAt: clock.wall()
    }
  ]

// 3. Fallback path with explicit confidence
stripe-webhook -> ingestCharge(invoiceId, stripeEventId, amount) in InvoicePayment(invoiceId)
on [invoice-issued(invoiceId)]
from [WebhookDedupView(stripeEventId) @eventual as dedup]
  --[dedup.unavailable]--> [
    payment-captured {
      invoiceId,
      stripeEventId,
      amount,
      capturedAt: clock.wall()
    } @confidence(level="low", reason="dedup_unavailable", asOf=clock.wall())
  ]

// 4. Read model
view PaymentStatusView(invoiceId) = [
  payment-captured(invoiceId),
  payment-refunded*(invoiceId)
] => {
  state,
  capturedAmount,
  refundedAmount,
  updatedAt
} @bergcache(key="payment:{invoiceId}", ttl=24h)
  @cost(memory="~150MB/region", readRpsPeak=12000)
  @ops(owner="billing-read-model", dashboard="invoice-payment-state")

// 5. Policy with explicit model scoring
payment-captured { invoiceId, amount }
  --[scoreBy("payment-fraud-v3", invoiceId) > 0.92]--> fraud-worker -> [
    payment-fraud-detected {
      invoiceId,
      score,
      model: "payment-fraud-v3",
      detectedAt: clock.wall()
    }
  ]
```

Why this scenario matters:

1. Confidence metadata works for fallback behavior unrelated to rate limiting.
2. Time semantics work with larger windows and webhook timing.
3. Cost/ops metadata remain first-class without introducing a second architecture language.

---

## 10. Companion Documents

- [ACTORS.md](./ACTORS.md) - Actor declarations and why they matter
- [SYSTEM-CONTEXT.md](./SYSTEM-CONTEXT.md) - System context blocks, external dependencies, and SLAs
- [THINKING-GUIDE.md](./THINKING-GUIDE.md) - Question vocabulary for debugging designs
- [INTERVIEW_SIMULATION.md](./INTERVIEW_SIMULATION.md) - Full interview walkthrough with the rate limiter
- [GLOSSARY.md](./GLOSSARY.md) - Canonical terminology reference

---

## 11. Derived Diagrams

The notation is enough to draw the system.
`eventline-axi` reads a model and derives the diagrams, so they never drift from the file.

```bash
npx eventline-axi diagram eventmodel examples/twitter-pure.dsl -o board.svg
npx eventline-axi diagrams examples/twitter-pure.dsl -o diagrams
```

| Diagram | Shows | Comes from |
| :--- | :--- | :--- |
| `eventmodel` | The Event Modeling board: actor, command, event, view and policy lanes, with consistency boundaries bracketed | commands, events, views, policies, `in Boundary(key)` |
| `context` | The system, who uses it, and what it depends on | `actor`, `system { external }`, commands per actor |
| `containers` | Command API, event store, read models, workers, outside systems | commands, `@partition`, views and `@cache`, policy workers |
| `dataflow` | Commands and workers as processes, the event log and views as stores | the same, drawn as flows |
| `deployment` | Each region with its shards, read models and workers | `system { region }`, boundaries, `@cost(regions=n)` |

Each diagram is available as `svg`, `mermaid` or `dot` (`-f`), and `-t dark` gives a dark theme.

Order on the board comes from causality, because a model has no clock.
A command sits after the commands whose events or views it reads.
A view sits right of the events that feed it, and a worker right of the event that wakes it.

The diagrams only draw what the model says.
Facts nobody emits show as a note under the command.
A command a policy calls but nobody declared is drawn dashed and marked "not modeled".
The model does not say which container calls an outside service, so no arrow is drawn into one.
The deployment view needs `region:` in the system block and assumes each region runs the whole stack unless a boundary says `@cost(regions=n)`.
