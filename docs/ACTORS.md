# Actors

Declare the people, services, and systems that interact with your domain. Actors make the "who can do what" question impossible to ignore.

---

## Syntax

```text
actor Name { attribute: value, ... }
```

**Attributes** (all optional):

| Attribute | Values | Meaning |
|---|---|---|
| `auth` | `none`, `session`, `oauth`, `mfa`, `api-key` | How the actor authenticates |
| `tier` | `free`, `pro`, `enterprise` | Access level or pricing tier |
| `scope` | comma-separated list | What data/actions the actor can touch |
| `rateLimit` | `X/min`, `X/hr` | Implicit rate limit on this actor's commands |

---

## Examples

```text
actor User { auth: session, tier: free|pro }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }
actor Service { auth: api-key, scope: read }
actor System { auth: m2m, tier: trusted }
```

---

## Why This Matters

Actors are the entry point for every non-functional concern:

- **Authentication**: Who is this? How do you prove it?
- **Authorization**: What can this actor do? What can't they?
- **Rate limiting**: Does this actor have different limits than others?
- **Data isolation**: Does `admin` see all users' data, or only their own?
- **Abuse patterns**: What does a malicious `visitor` look like vs. a legitimate `user`?

Without actor declarations, commands like `user -> makeRequest()` hide these questions. With actors, they're visible.

---

## Actors and Commands

Every command has an implicit actor. Declaring actors explicitly means you can:

1. **Audit coverage**: "Which actors can call `makeRequest`? Is it only `User`, or can `Admin` and `Visitor` too?"
2. **Spot missing auth**: "`Visitor -> viewPublicPage()` has no auth guard. Is that intentional?"
3. **Model escalation**: "Can a `User` become an `Admin`? What event triggers that transition?"

```text
actor User { auth: session, tier: free|pro }
actor Admin { auth: oauth, mfa: required }

user -> makeRequest(resourceId)
  --[count < tier.limit]--> [request-logged { ... }]

admin -> makeRequest(resourceId)
  --[default]--> [request-logged { ... }]
```

Notice: `admin` has no rate limit. That's a design decision worth naming.

---

## Actors and Boundaries

Boundaries partition by keys. Actors determine *who* operates within those partitions.

```text
boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId")

boundary AdminAudit(adminId, action)
  @partition(shardKey="adminId")
  @cost(writeRpsPeak=100)
```

Different actors, different boundaries, different scale assumptions.

---

## Anti-Patterns

### ❌ Implicit Actors

```text
// Bad: who is "the caller"?
caller -> processPayment(invoiceId)
```

```text
// Good: explicit actor with auth model
actor User { auth: session, tier: pro }
user -> processPayment(invoiceId)
```

### ❌ One Actor to Rule Them All

```text
// Bad: everything is "user" — admin, visitor, service, all the same
actor User { auth: session }
```

```text
// Good: distinct actors with distinct capabilities
actor User { auth: session, tier: free|pro }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }
actor PaymentService { auth: m2m, scope: payment }
```

---

## In Interviews

When you introduce actors, say:

> "Before I model the commands, I want to name the actors. This system has three: `User` (authenticated, tiered), `Admin` (MFA required), and `Visitor` (no auth). Each has different capabilities and rate limits."

This signals to the interviewer that you're thinking about auth, authorization, and abuse patterns from the start.
