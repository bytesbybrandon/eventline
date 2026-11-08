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
