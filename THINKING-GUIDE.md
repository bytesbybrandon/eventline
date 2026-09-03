# System Design Thinking Guide

Use this when reviewing a DSL model. These questions are the "debug skill" — they help you inspect your design and find what's missing.

The goal is not to answer every question. The goal is to notice which ones you *can't* answer, because those are the gaps in your design.

---

## How to Use This

1. Write your event model (actors, system context, commands, boundaries, views, policies).
2. Walk through each section below and ask the questions.
3. Anything you can't answer confidently is a gap to fill.

---

## Actors

- Who is missing from the actor list?
- What authentication does each actor require?
- Can an actor escalate privileges? How?
- What does an unauthenticated actor see?
- Are there service-to-service actors? Do they have API keys or mTLS?
- Can a `Visitor` become a `User`? What event triggers that?
- Do all actors have rate limits? Are they the same limits?

---

## System Context

- What external services does this depend on?
- What's the blast radius if each external service fails?
- Are the SLAs realistic given the external dependencies?
- What data classification applies (PII, PCI, PHI, etc.)?
- Which regions are users in? Are the regions in the model?
- If this system goes down, what else goes down?
- Are there regulatory constraints (GDPR, HIPAA, SOC2) that affect the design?

---

## Commands

- Who calls this command? Is that actor declared?
- What permissions does the actor need?
- What happens if the precondition events are missing?
- Is the guard logic in the hot path? Can it be cached?
- Can this command be called concurrently? What prevents race conditions?
- What's the latency budget for this command? Does the implementation fit?
- Does this command emit multiple events? Are they all necessary?
- Is there a compensating command if this fails mid-way?

---

## Boundaries

- What's the partition key? Could one key become a hotspot?
- What's the write RPS per shard? Is that sustainable?
- What happens when the boundary exceeds its `@cost` limits?
- Is the replication strategy synchronous or async? What's the lag?
- What happens if a shard goes down? How fast can it failover?
- Are commands on the same partition serialized? Is that a bottleneck?
- Does the boundary span multiple regions? What's the consistency story?

---

## Views

- What's the freshness requirement? Is `@eventual` really acceptable?
- What's the read RPS? Does the cache have enough headroom?
- What happens when the view is stale? Does the guard still work correctly?
- Can the view be rebuilt from events if the cache dies?
- What's the eviction strategy? LRU? TTL? Size-based?
- Does the view contain derived data? If so, is the derivation deterministic?
- Is the view accessed in the hot path? Could it become a bottleneck?

---

## Policies

- Is the policy in the hot path or async? Does it affect user-facing latency?
- What happens if the worker/service is down? Do events queue? Expire?
- Can the policy emit conflicting commands? How is that resolved?
- Does the policy cross boundaries? If so, what's the consistency story?
- Is the policy idempotent? What happens if it processes the same event twice?
- What's the scaling strategy for the policy worker?
- Can the policy be disabled? Is there a kill switch?

---

## Guards

- Is the guard evaluating against stale data?
- Can the guard be bypassed by race conditions?
- What's the failure mode if the guard's view dependency is unavailable?
- Are there side effects in the guard? (There shouldn't be.)
- Is the guard logic expensive? Does it fit in the latency budget?
- Can the guard be cached? If so, what's the invalidation strategy?
- Are all branches covered? Is there a `--[default]-->` fallback?

---

## Events

- Is every event name in the `{aggregate}[-fragments]*-{verb}` shape?
- Are events immutable? Can they be deleted or modified?
- What's the retention policy? How long are events kept?
- Can events be replayed? Are projections deterministic?
- Is the event payload minimal? Are there derived fields that should be in views instead?
- Are there events that should never be emitted (e.g., sensitive data in logs)?
- What's the event schema? Is it versioned?

---

## Time Semantics

- Which clock is used? `clock.wall()` (processing time) or `clock.event()` (event time)?
- Are time windows aligned across boundaries?
- What's the clock skew budget? Is it realistic for the deployment region?
- Are temporal operators (`*` for "zero or more") used correctly? Only on events, not views.
- What happens at window boundaries? Is there a race between window roll and request?

---

## Cost and Operations

- Are `@cost` annotations realistic? How were the numbers derived?
- Are `@ops` annotations complete? Owner, SLO, alert, dashboard, runbook?
- Who is on call for this boundary/view/policy?
- What's the alert threshold? Is it tuned to the SLO?
- Is there a runbook for the most likely failure mode?
- Are costs tracked per-boundary, or just at the system level?

---

## Cross-Cutting Concerns

- Is there a single point of failure anywhere in the model?
- What happens if the event log is unavailable?
- Is there a backpressure mechanism? What happens when producers outpace consumers?
- Are there circular dependencies between policies?
- Is the system testable? Can you replay events to reproduce a bug?
- Is the model complete enough to generate code? Or is it still prose with syntax highlighting?

---

## The "So What?" Test

For every primitive in your model, ask:

> "So what? What breaks if this is wrong?"

- If you can't answer, you don't understand the concern well enough.
- If the answer is "nothing breaks," the primitive might be unnecessary.
- If the answer is "everything breaks," you've found a critical dependency.

---

## In Interviews

You don't need to answer every question. You need to demonstrate that you *know* the questions exist.

When you hit a gap, say:

> "I haven't modeled the Stripe failure mode yet. If Stripe is down, I'd need a fallback — either queue the payment for retry or return a 503 with a retry-after header. I'd model that as a policy on `stripe-webhook-timeout`."

This shows the interviewer that you think in terms of failure modes, not just happy paths.
