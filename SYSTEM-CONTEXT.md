# System Context

Declare the system's external dependencies, global SLAs, constraints, and data classification. This is the "why" behind the numbers in your model.

---

## Syntax

```text
system SystemName {
  external: service-name (role), service-name (role)
  slo: metric target, metric target
  region: region-list
  data-classification: classification
  constraint: description
}
```

**Attributes** (all optional, but at least one is recommended):

| Attribute | Values | Meaning |
|---|---|---|
| `external` | `name (role)` | External services this system depends on |
| `slo` | `metric target` | Global service-level objectives |
| `region` | comma-separated list | Geographic deployment regions |
| `data-classification` | `pii`, `pci`, `phi`, `public`, `internal` | Data sensitivity level |
| `constraint` | free text | Hard constraints (e.g., "must run on-prem", "GDPR compliant") |

---

## Examples

```text
system RateLimiterAPI {
  external: stripe (payment-gateway), sentry (monitoring)
  slo: 99.99% uptime, p99 < 2ms
  region: us-primary, eu-secondary
  data-classification: pii
}

system PaymentProcessor {
  external: stripe (payment), paypal (payment), twilio (sms)
  slo: 99.95% uptime, p99 < 500ms
  region: us-east, us-west, eu-west
  data-classification: pci
  constraint: must support 3DSecure fallback
}
```

---

## Why This Matters

System context turns arbitrary numbers into grounded decisions:

- **External dependencies** imply failure modes. If `stripe` is down, what happens to `processPayment`?
- **SLOs** drive architecture. 99.99% uptime means <44s downtime/month. That requires replication, failover, and health probes.
- **Regions** affect latency and data residency. A user in EU hitting a US-primary boundary has higher latency and potential GDPR issues.
- **Data classification** affects encryption, access control, and audit requirements.

Without a system context, `@cost(writeRpsPeak=50000)` appears in a vacuum. With it, the number is grounded in a system that promised 99.99% uptime and <2ms latency.

---

## External Dependencies

Every `external` declaration is a potential failure point. When you list one, you should also model its failure mode:

```text
system PaymentAPI {
  external: stripe (payment)
}

// If Stripe is down:
stripe-webhook-timeout { invoiceId }
  --[timeout > 5s]--> [
    payment-deferred { invoiceId, reason: "stripe_unavailable" }
  ]
```

If you declare an external dependency but never model its failure, that's a gap.

---

## SLOs and Boundaries

SLOs should map to specific boundaries:

```text
system RateLimiterAPI {
  slo: 99.99% uptime, p99 < 2ms
}

boundary UserRateLimit(userId, currentMinute)
  @ops(slo="99.99%", alert="rate-limit-shard-unavailable")
  @time(window="fixed:1m", clockSkewBudget="<250ms")
```

The boundary's `@ops` should reference the system's SLO. If it doesn't, ask: "Is this boundary covered by the global SLO, or does it need its own?"

---

## Regions and Partitioning

Regions affect partition strategy:

```text
system GlobalAPI {
  region: us-primary, eu-secondary, ap-southeast
}

boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId")
  @replication(mode="async", lagSla="<5s")
```

Multi-region implies replication strategy. Async replication means some regions see stale data. Ask: "Is staleness acceptable for this boundary? What's the user experience in EU while US primary is catching up?"

---

## Data Classification

Data classification affects encryption, access control, and retention:

```text
system HealthRecords {
  data-classification: phi
}

// PHI requires:
// - Encryption at rest and in transit
// - Audit logging on all access
// - Retention policies (e.g., 7 years)
// - Access limited to minimum necessary
```

If you declare `data-classification: pii` or `pci`, your model should have corresponding guards, encryption annotations, or access controls. If it doesn't, that's a gap.

---

## Anti-Patterns

### ❌ No System Context

```text
// Bad: numbers without context
boundary UserRateLimit(userId, currentMinute)
  @cost(writeRpsPeak=50000)
  @ops(slo="99.99%")
```

Where did 50k come from? Why 99.99%? What external services does this touch?

### ❌ Context Without Consequences

```text
// Bad: declared external dependency, never referenced
system PaymentAPI {
  external: stripe (payment)
}

// ... 50 lines of DSL later, no mention of Stripe failure mode ...
```

If you declare it, model it. Otherwise the declaration is noise.

---

## In Interviews

Open with the system context:

> "Before I model the event flow, here's the system context: this is a rate limiter API with 99.99% uptime and <2ms p99 latency, deployed in US-primary and EU-secondary. It depends on Stripe for payments and Sentry for monitoring. Data is PII."

This gives the interviewer the constraints you're working within, and it signals that you're thinking about the full system, not just the happy path.
