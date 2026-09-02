# Domain Model Glossary: System Design DSL

This glossary captures the precise definitions that emerged from grilling and domain modeling work. **Use this as the canonical reference for DSL terminology.**

---

## Core Concepts

### Fact

A **Fact** is a typed precondition input to a command decider.

Facts are resolved at command handling time and bind to guard evaluation. Every fact has a declared source (Event or View) and consistency contract. Facts are never raw data; they are assertions bound to a specific command execution within a boundary.

A fact can be one of two kinds:
- **Event Fact**: resolved from event history; represents what must have happened.
- **View Fact**: resolved from a projection; represents current state.

**Example:**
```text
on [ user-authenticated(userId) ]              ← Event Fact
from [ UserTierCache(userId) as tier ]         ← View Fact
```

---

### Event

An **Event** is the authoritative, append-only record of a domain state transition that already occurred.

Event names must follow:

```text
{aggregate}[-fragments]*-{verb}
```

Examples:
- `payment-applied`
- `package-delivery-stalled`
- `request-logged`

Events are the single source of truth for:
- Write-side correctness (guards check events to decide)
- Replay (projections recompute from events)
- Audit (events form an immutable ledger)

Events can be queried in commands via `on [...]` clauses. Temporal operators (e.g., `*` for "zero or more in window") apply only to events, not views.

**Key property:** Events are never mutated; they are only appended.

**Example:**
```text
user-authenticated { userId, email, tier, authenticatedAt }
request-logged { userId, resourceId, timestamp, count }
rate-limit-exceeded { userId, resourceId, retryAfter }
```

---

### View

A **View** is a deterministic projection derived from events for read efficiency.

Views are:
- **Derived, not authoritative:** Computed from events; if a projection falls behind, its outputs can be stale.
- **Read models:** Optimized for queries; may use caching, denormalization, or other performance tricks.
- **Materialized or computed:** Can be eagerly cached (Bergcache) or computed on-demand.

Views are read in commands via `from [...]` clauses. Freshness policy must be declared or inferred (default: eventual consistency).

**Key property:** Views can be reconstructed from events; they are not primary domain state.

**Example:**
```text
view UserQuotaWindow(userId, minute) = [
  request-logged*(userId, minute)
] => {
  count,
  remaining: limit - count,
  windowStart, windowEnd
} @bergcache(ttl=60s)

view UserTierCache(userId) = [
  tier-assigned(userId, tier)
] => { tier, limit } @bergcache(ttl=24h)
```

---

### Command

A **Command** is an intent evaluated by a pure decider against resolved Facts.

Commands:
- Accept actor input and parameters.
- Declare event preconditions (`on`) and view preconditions (`from`).
- Apply guards to Facts to make decisions.
- Emit zero or more Events atomically within a Boundary.

Commands are **pure:** they do not mutate Views directly. Views are updated asynchronously by projection workers after events commit.

**Example:**
```text
user -> makeRequest(resourceId)
on [
  user-authenticated(userId),
  request-logged*(userId, currentMinute)
]
from [
  UserTierCache(userId) as tier
]
  --[count < tier.limit]--> [ request-logged {...} ]
  --[count >= tier.limit]--> [ rate-limit-exceeded {...} ]
```

---

### Boundary (Dynamic Consistency Boundary)

A **Boundary** defines the atomicity, isolation scope, and partition key for command execution.

Boundaries:
- Partition state by key (e.g., `userId`, `window`).
- Ensure that all reads and writes within one command execution are consistent with the same version of event history.
- Allow concurrent commands on *different* partitions; serialize commands on the *same* partition.

**Key property:** All Facts resolved in `on` are read from the same consistent snapshot of events. Views in `from` may be stale (subject to freshness policy).

**Example:**
```text
boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId", fanout=100000)
  @leader("primary-region", failover="secondary-region")
  @replication(mode="async", lag_sla="<5s")
```

---

### Policy

A **Policy** is an automated reaction to events.

Policies:
- Listen for events.
- Apply guards to decide actions (other events, side effects, or control-plane operations).
- Are eventually consistent (may observe events out-of-order or with delay).

Policies are the primary mechanism for resilience, monitoring, and cross-boundary coordination.

**Example:**
```text
request-logged { userId }
  --[count_burst > quota * 2 in 1s]--> [
    quota-anomaly-detected { userId, excessCount }
  ]

quota-anomaly-detected { userId, excessCount }
  --[anomaly_score > 0.7]--> waf-svc -> temporaryBlock(userId, 5m)
```

---

## Derived Concepts

### Guard

A **Guard** is a boolean condition evaluated during command execution that branches behavior.

Guards:
- Are written as predicates over resolved Facts: `count < tier.limit`.
- Use `--[guard]-->` syntax to show the transition arrow with decision embedded.
- Determine which events are emitted.

Guards are **pure functions** of Facts; they do not perform I/O or mutations.

---

### Partition Key

A **Partition Key** is the attribute(s) used to shard state within a Boundary.

The partition key determines:
- Which shard a command's Facts are read from.
- Which shard a command's Events are appended to.
- Concurrency isolation: commands with the same partition key serialize; commands with different keys run concurrently.

**Example:** Partition by `userId` means all requests from one user go to one shard (same partition key), but requests from different users can run in parallel (different keys).

---

### Consistency Model

The **Consistency Model** describes when Facts become visible to subsequent commands.

- **on [...]** (event facts): Evaluated at command time; visible within the boundary's isolation scope.
- **from [...]** (view facts): Subject to freshness policy; may be stale.

**Default:** Views are eventual-consistent (stale is acceptable unless otherwise specified).

---

### Freshness Policy

A **Freshness Policy** specifies how recent a view must be.

Options:
- `@fresh<X>`: View must be updated within X duration (e.g., `@fresh<60s>` means < 1 minute old).
- `@eventual`: View is eventually consistent; staleness is acceptable.
- `@strong`: View must reflect all prior events (expensive; rarely needed).

**Default:** `@eventual` (no staleness bound).

**Example:**
```text
from [
  UserTierCache(userId) @eventual,       ← tier changes daily, staleness OK
  request-count(userId, minute) @fresh<1s> ← quota must be recent
]
```

---

### Confidence Metadata

**Confidence metadata** marks certainty of an emitted event outcome when source quality differs (for example stale-cache fallback).

Use `@confidence(...)` on the event emission instead of creating duplicate event names solely for confidence differences.

**Example:**
```text
request-logged { userId, requestMinute, requestAt }
  @confidence(level="low", reason="stale_quota", asOf=cache.timestamp)
```

---

### Time Semantics

**Time semantics** define exactly which clock and window model the DSL is using.

- `clock.wall()` = processing-time wall clock
- `window.floor(t, 1m)` = minute bucket for time `t`
- `window.end(bucket, 1m)` = bucket end timestamp

Boundary-level `@time(...)` annotations declare default behavior and skew assumptions.

**Example:**
```text
boundary UserRateLimit(userId, currentMinute)
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
```

---

### Cost Annotation

`@cost(...)` captures expected scale and resource assumptions near the modeled component.

Use it on boundaries, views, and heavy policies to make trade-offs reviewable during design.

**Example:**
```text
@cost(regions=3, shardFanout=100000, writeRpsPeak=50000)
@cost(memory="~6MB/region", readRpsPeak=50000)
```

---

### Operations Annotation

`@ops(...)` captures runtime ownership and operating expectations.

Common fields: `owner`, `slo`, `alerts`, `dashboard`, `runbook`, `traces`.

**Example:**
```text
@ops(owner="traffic-platform", slo="99.99%", alert="rate-limit-shard-unavailable")
@ops(runbook="runbooks/rate-limit-failover.md", traces=["makeRequest"])
```

---

### Boundary-Consistent Read

A **Boundary-Consistent Read** is a read of all Facts within a command's Boundary that is guaranteed to reflect the same version of event history.

This means:
- All `on [...]` events are read from the same snapshot.
- No events arrive between reading different event facts.
- Guards see a coherent view of history.

This does NOT mean events are up-to-date globally; they are up-to-date within the boundary's partition.

---

### Projection

A **Projection** is the process of deriving a View from events.

Projections:
- Transform events into readable state (e.g., sum requests per minute → count).
- Run asynchronously after events commit.
- Can be replayed if state is lost.

Projections are the implementation of Views; the DSL models projections as Views.

---

### Saga

A **Saga** is a multi-step workflow coordinated by policies.

A saga is:
- Not a single command (single atomic boundary).
- A choreography of commands triggered by events and policies.
- Implements distributed transactions.

**Example:** Transfer-funds saga:
1. User issues `transferFunds` command.
2. Command emits `funds-reserved` event.
3. Policy listens for `funds-reserved`, triggers `chargeSourceWallet`.
4. That command emits `source-charged`.
5. Policy listens, triggers `depositDestinationWallet`.
6. Final command emits `transfer-complete`.

In DSL: commands/policies handle each step; boundaries ensure atomicity within each step.

---

## Usage Patterns

### When to Use Events in `on`

Use event facts when:
- The condition **must have happened** (e.g., user authenticated, payment authorized).
- You need **causal ordering** (e.g., before we log a request, we need proof of authentication).
- The condition is **audit-critical** (i.e., should be logged for compliance).

**Example:**
```text
on [ user-authenticated(userId), tier-assigned(userId, tier) ]
```

### When to Use Views in `from`

Use view facts when:
- You need **current state** (e.g., what's the user's tier *now*?).
- The value **changes frequently** and recomputing is expensive (e.g., request count in a window).
- **Staleness is acceptable** (within bounds of freshness policy).
- The fact is a **performance optimization** (e.g., cached tier vs re-reading from tier-assignment events).

**Example:**
```text
from [
  UserTierCache(userId) @eventual,
  user-quota-window(userId, minute) @fresh<1s>
]
```

### When to Use Policies

Use policies when:
- You need **eventual reactions** (e.g., detect abuse, trigger failover).
- **Distributed coordination** is needed (crossing boundaries).
- **Asynchrony is acceptable** (events may arrive out-of-order or with delay).

**Example:**
```text
quota-anomaly-detected { userId, excessCount }
  --[anomaly_score > 0.7]--> waf-service -> blockUser(userId)
```

---

## Anti-Patterns

### ❌ Mixing Events and Views in `on`

**Bad:**
```text
on [
  user-authenticated(userId),  ← event
  user-tier(userId),           ← view (ambiguous!)
  request-logged*(userId, min) ← event
]
```

**Good:**
```text
on [ user-authenticated(userId), request-logged*(userId, min) ]
from [ UserTierCache(userId) ]
```

**Why:** Mixing obscures which facts are authoritative vs cached.

---

### ❌ Assuming Views Are Always Fresh

**Bad:**
```text
from [ UserTierCache(userId) ]  ← no staleness bound; might be 24h old!
  --[tier == "premium"]--> [ charge-premium-rate { ... } ]
```

**Good:**
```text
from [ UserTierCache(userId) @fresh<1h> ]  ← explicit staleness bound
  --[tier == "premium"]--> [ charge-premium-rate { ... } ]
```

**Why:** Staleness assumptions must be explicit; lazy inference causes surprises.

---

### ❌ Putting Temporal Operators on Views

**Bad:**
```text
from [ user-requests(userId)* over 1m ]  ← wrong; temporal is for events
```

**Good:**
```text
on [ request-logged*(userId, window: 1m) ]
```

**Why:** Temporal windows describe event history; views describe current state.

---

### ❌ Commands Mutating Views

**Bad:**
```text
// In a command:
user-tier.limit := 200  ← NO! Views are read-only.
```

**Good:**
```text
// Command emits event:
  --[new_plan == "pro"]--> [ user-upgraded-to-pro { userId } ]

// Policy listens and any projection updates views asynchronously:
user-upgraded-to-pro { userId }
  -> tier-projector -> update-user-tier-cache(userId, "pro")
```

**Why:** Commands are pure; all mutations flow through events.

---

## Summary Table

| Concept | Role | Source | Mutability | Consistency |
|---------|------|--------|-----------|---|
| **Event** | Authoritative record | Appended by commands | Immutable | Boundary-consistent (within partition) |
| **View** | Read model | Computed from events | Immutable (from command perspective) | Subject to freshness policy (default: eventual) |
| **Fact** | Precondition to command | Event or View | Immutable | Varies by kind |
| **Command** | Intent decider | Actor (client) | No; only emits events | Atomic within boundary |
| **Boundary** | Consistency scope | Configuration | No | Defines isolation and atomicity |
| **Policy** | Automated reaction | Event listener | No; only emits new events | Eventually consistent |

---

## References

- **System Design DSL:** README.md
- **Interview Simulation:** INTERVIEW_SIMULATION.md
- **ADR (Events vs Views):** ADR-EVENTS-VS-VIEWS.md

