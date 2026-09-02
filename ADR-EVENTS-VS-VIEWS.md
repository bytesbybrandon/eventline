# ADR: Separate Event Dependencies from View Lookups (on vs from)

**Status:** Accepted  
**Date:** 2026-09-02  
**Supersedes:** DSL v1 (mixed event/view syntax)

---

## Context

The original DSL allowed commands to declare preconditions in a single `on [...]` clause that mixed:
- **Events** (causal history, must-have-happened facts)
- **Views** (derived projections, cached values, current-state lookups)
- **Temporal windows** (event streams over time)

Example of ambiguity:
```text
user -> makeRequest(resourceId) on [
  user-authenticated(userId),     ← event? projection? unclear
  user-tier(userId, tier),        ← definitely not an event, but syntax hides it
  request-logged*(userId, minute) ← event with temporal window
]
```

This creates three problems:

1. **Semantic ambiguity:** Readers cannot infer the nature of a fact from syntax alone.
2. **Execution ambiguity:** Runtime behavior is underspecified (is the view stale? blocked? cached?).
3. **Interview friction:** Candidates are forced to remember hidden typing rules while designing under pressure.

---

## Decision

Introduce **separate clauses** for event dependencies and view lookups:

```text
user -> makeRequest(resourceId)
on [
  user-authenticated(userId),
  request-logged*(userId, currentMinute)
]
from [
  UserTierCache(userId) as tier
]
  --[count < tier.limit]--> [
    request-logged { userId, resourceId, count: count + 1 }
  ]
  --[count >= tier.limit]--> [
    rate-limit-exceeded { userId, resourceId }
  ]
```

**Semantics:**
- `on [...]` contains **event facts only.** Causal dependencies, must-have-happened conditions, event windows. No projections.
- `from [...]` contains **view facts only.** Read-model lookups, cached projections, current-state queries. No events, no temporal operators.

**Enforcement:**
- Lint error if a view/projection symbol appears in `on`.
- Lint error if an event-window operator (e.g., `*`, temporal range) appears in `from`.
- Warning if a view reference in `from` has no declared staleness/consistency policy.

---

## Rationale

1. **Clarity:** Syntax now mirrors semantics. A reader instantly knows which facts are authoritative (events) vs optimized (views).

2. **Runtime contract:** Different clauses can have different consistency/freshness contracts:
   - `on`: "Evaluate against event history within this boundary; results are authoritative for guard evaluation."
   - `from`: "Perform read-model/projection lookup; subject to stated freshness policy; may be stale."

3. **Interview ergonomics:** Candidates naturally think in this order:
   - "What events must have happened for this request to succeed?" → `on`
   - "What current facts do I need to check?" → `from`

4. **Extensibility:** Clean separation allows future enhancements (e.g., freshness policies per view, consistency modes) without clause overload.

---

## Consequences

### Positive

- Improves readability and whiteboard-friendliness.
- Enables deterministic parsing and validation.
- Prevents semantic drift (clause overloading).
- Makes consistency assumptions explicit in command text.
- Supports runtime instrumentation: can log/audit which events were checked vs which views were queried.

### Negative

- Adds one clause to grammar and documentation.
- Requires migration of existing mixed-syntax examples.
- Slightly more verbose for simple commands (trade-off: clarity > brevity).

### Neutral

- Caching is still an implementation detail of views; the DSL doesn't require explicit cache declarations.
- Projection lag/freshness is now visible at use-site (in `from`), improving traceability.

---

## Implementation

### Grammar Change

```
command = actor "->" verb "(" params ")"
          [ "on" "[" event_facts "]" ]
          [ "from" "[" view_facts "]" ]
          ( "--[" guard "]-->" "[" events "]" )+

event_fact = event_name "(" params ")"
           | event_name "(" params ")" "*"        // temporal window

view_fact = view_name "(" params ")" [ "as" identifier ]
          | view_name "(" params ")" "@fresh<TTL>" [ "as" identifier ]

```

### Validation Rules

| Rule | Severity | Message |
|------|----------|---------|
| Event in `from` | Error | `{name} is an event; move to on [...]` |
| View in `on` | Error | `{name} is a view; move to from [...]` |
| Window operator in `from` | Error | Temporal operators not allowed in from; move to on [...] |
| `from` without consistency policy | Warning | View {name} has no stated freshness; consider adding @fresh<TTL> or @eventual |
| Event name does not match `{aggregate}[-fragments]*-{verb}` | Error | Rename event to DSL event convention |

Event naming examples:
- `payment-applied`
- `package-delivery-stalled`
- `user-authenticated`

### Linter Examples (Pass/Fail)

1. Clause typing

Pass:
```text
user -> makeRequest(resourceId)
on [user-authenticated(userId), request-logged*(userId, currentMinute)]
from [UserTierCache(userId) @fresh<24h> as tier]
```

Fail:
```text
user -> makeRequest(resourceId)
on [user-authenticated(userId), UserTierCache(userId)]
```

Expected error:
`UserTierCache is a view; move to from [...]`

2. Event naming

Pass:
```text
payment-captured { invoiceId, capturedAt: clock.wall() }
```

Fail:
```text
paymentCapture { invoiceId }
```

Expected error:
`event name 'paymentCapture' does not match {aggregate}[-fragments]*-{verb}`

3. Confidence attachment target

Pass:
```text
request-logged { userId, requestAt: clock.wall() }
  @confidence(level="low", reason="stale_quota")
```

Fail:
```text
@confidence(level="low")
user -> makeRequest(resourceId)
```

Expected error:
`@confidence(...) must be attached to an emitted event`

4. Window source type

Pass:
```text
on [request-logged*(userId, window: currentMinute)]
```

Fail:
```text
from [UserQuotaView(userId)*]
```

Expected error:
`temporal operators are not allowed in from [...]; move windowed checks to on [...]`

5. Time semantics completeness

Pass:
```text
boundary UserRateLimit(userId, currentMinute)
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
```

Fail:
```text
boundary UserRateLimit(userId, currentMinute)
```

Expected warning:
`boundary has windowed guards but no @time(...) annotation`

### Example Migration

**Before:**
```text
wallet-owner -> transferFunds(toWallet, amount)
on [
  wallet-balance(fromWallet),        ← ⚠️ view, not event
  balance-checked(fromWallet),        ← event
  fraud-score(owner) < 0.5            ← view, condition-like
]
```

**After:**
```text
wallet-owner -> transferFunds(toWallet, amount)
on [
  balance-checked(fromWallet)
]
from [
  wallet-balance(fromWallet) as balance,
  fraud-score(owner) @fresh<5m> as score
]
  --[balance >= amount && score < 0.5]--> [
    funds-transferred { ... }
  ]
```

---

## Related Decisions

- **ADR: Facts vs Events vs Views** (domain model clarification)
  - Fact = precondition input to a command, with declared source (Event or View)
  - Event = authoritative record of state transition
  - View = deterministic projection derived from events

---

## Review & Acceptance

- **Grilling Session:** Exposed ambiguity in original syntax; alternative A (on/from split) scored highest on clarity (9/10) and precision (9/10).
- **Domain Model Review:** Confirmed that on/from separation aligns with event-sourcing best practices and interview pedagogy.
- **Interview Simulation:** Applied to rate-limiter case study; syntax is more natural and catches consistency assumptions early.

---

## Future Work

- Add optional freshness overrides: `from [ view(x) @fresh<30s> ]`
- Consider metadata annotations on views: `@cacheable`, `@replicated`, `@metered`
- Formalize consistency modes for `on`: `@eventual`, `@strong`, `@causal`
- Tooling: VS Code syntax highlighter, linter, simulator

---

## Post-ADR Extensions (Accepted)

The following extensions were adopted to close known modeling gaps:

1. **Confidence semantics**
  - Event emissions can carry confidence metadata: `@confidence(level="low", reason="stale_quota", asOf=...)`.
  - Prevents event-type explosion when outcome is identical but certainty differs.

2. **Formal time semantics**
  - Time intent is explicit via `@time(...)` and time helpers such as `clock.wall()`, `window.floor(...)`, `window.end(...)`.
  - Removes ambiguity around `currentMinute`, retry windows, and stale checks.

3. **Cost and operations metadata**
  - Hot paths support `@cost(...)` for scale assumptions and `@ops(...)` for ownership, SLOs, alerts, traces, and runbooks.
  - Keeps architecture and operational intent inside the same design artifact.

