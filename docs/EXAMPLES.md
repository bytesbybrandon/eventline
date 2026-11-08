# Worked examples

Each model here is also a file in [`examples/`](../examples), so you can run the CLI on it.

```bash
npx -y eventline-axi validate examples/rate-limiter.dsl
npx -y eventline-axi diagrams examples/rate-limiter.dsl -o diagrams
```

`examples/twitter-pure.dsl` is the third example and is the one the site uses.

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

## 9. Worked Scenario: Payment Capture Webhook (Non-Rate-Limiter)

This scenario proves the extensions generalize outside traffic control.

```text
system PaymentProcessor {
  external: stripe (payment)
  region: us-east, eu-west
  data-classification: pci
}

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

// 3b. Dedup read model: has this webhook event already been captured?
view WebhookDedupView(stripeEventId) = [payment-captured(invoiceId)] => {
  seen
} @bergcache(key="dedup:{stripeEventId}", ttl=24h)

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
