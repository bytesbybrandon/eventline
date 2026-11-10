# eventline language reference

The notation in full: the four primitives, how they map to Event Modeling, how to introduce a model, the validation checklist and the normative grammar.
Worked models are in [EXAMPLES.md](./EXAMPLES.md).
Terms are defined in [GLOSSARY.md](./GLOSSARY.md).

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

---

## 6. Actors & System Context (Step 0)

Before modeling commands, declare your actors and system context.

**Actors** are the people, services, and systems that interact with your domain. See [ACTORS.md](./ACTORS.md).

**System Context** is the top-level block that names external dependencies, global SLAs, regions, and data classification. See [SYSTEM-CONTEXT.md](./SYSTEM-CONTEXT.md).

These declarations make the "who can do what" and "what happens if X fails" questions impossible to ignore.

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
          [ annotations ]
          [ "on" "[" event_facts "]" ]
          [ "from" "[" view_facts "]" ]
          branch+

params = param { "," param }
param  = name [ "?" ] [ ":" type ]

branch = "--[" guard "]-->" ( "[" emitted_events "]" | "reject" CODE )

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

## 9. Contexts, Refusals, Timers, Notes and Types

These constructs are all optional.
A model without them still parses and means what it did before.

### Contexts

```text
context Billing {
  description: Invoices and refunds
  role: core
  publishes: invoice-opened, invoice-refunded

  user -> openInvoice(amount: number) in Invoice(invoiceId)
    --[default]--> [invoice-opened { invoiceId, amount }]
}
```

A context groups statements into a bounded context with its own language and rules.
Its attributes are `description`, `role` (`core` or `adapter`) and `publishes`, the events other contexts may rely on.
Any other `key: value` line is kept as an attribute, for example `infrastructure: Postgres`.
The `system` block stays outside any context.

A context is not a boundary.
A boundary (section 3) is a consistency scope: the key a decision reads and writes by.
One boundary, such as `Slice(sliceId)`, can be touched by commands in several contexts, and one context usually uses several boundaries.

`eventline-axi validate` warns when a context reads an event that another context emits but does not list in `publishes`.
`eventline-axi diagram contextmap` draws the contexts and the events that cross between them.

### Refusals

```text
user -> signUp(email: text)
  --[an account with this email exists]--> reject EMAIL_TAKEN
  --[default]--> [account-created { email }]
```

`reject CODE` refuses the command and records nothing.
The guard text is the reason in plain words, and the code is stable and written in capitals.
A refusal is not an event, so it never appears in the event list.
If a refusal should be remembered as a fact, for example for an audit trail, emit an event instead.
`validate` points out events named `...-rejected` so you can choose on purpose.

### Timers

```text
every 5 minutes
from [StaleLeases(sessionId)]
  -> lease-sweeper -> releaseLeases(sessionId)

cron "0 * * * *"
  -> hourly-report -> buildReport()
```

A policy can start on a schedule instead of an event, with `every N seconds|minutes|hours|days` or `cron "..."`.
Any policy can read views first with `from [...]`, using the same facts and freshness as a command.

### Triggers

```text
auditor -> failAudit(auditId: id)
  @trigger(type=ui, name="AuditingScreen", part="Fail button", route="POST /audits/{id}/fail")
  on [audit-started]
  --[default]--> [audit-failed]

translation-engine -> submitTranslation(text: text)
  @trigger(type=endpoint, name="Translation API", route="PUT /translations/{id}")
  --[default]--> [translation-submitted]
```

`@trigger(...)` says what an actor uses to reach a command, or where a view is read.
The actor is the one who uses it, and the trigger is the thing used.

| Key | Meaning |
| :--- | :--- |
| `type` | `ui`, `endpoint`, `cli` or `agent` |
| `name` | The screen, API, command line tool or agent, such as `AuditingScreen` |
| `part` | Optional. The part of it: a button, a toggled view, a permission-filtered view |
| `route` | Optional, `ui` and `endpoint` only. `METHOD /path` that this use calls |

A command or view can have several `@trigger` annotations.
Two commands can use the same screen with different parts and routes, because a route belongs to the use and not to the screen.
A job that starts on a schedule is not a trigger.
Write it as a timer policy.

`eventline-axi triggers <file>` lists every trigger, its part and route, who uses it and what it reaches.
The board writes the trigger on the arrow from the actor to the command, and under a view that is read through one.
`validate` warns about an unknown `type`, a missing `name`, a route that is not `METHOD /path`, and a route on a `cli` or `agent` trigger.
It adds an info note for a command with no trigger once any other command has one.

### Notes and annotations

```text
user -> postTweet(content: text) @note("the retry is safe because the id is a client token") @planned
```

`@note("...")` attaches free text to a command, view, policy or boundary.
Use it for what the notation does not model, such as which screen or endpoint starts a command.
Notes can repeat, and diagrams show them as tooltips.
Other useful annotations on commands, views and policies are `@planned` for decided but not built, `@slice("name")` and `@story("...")` for tools that track slices, and `@state(...)` for state-backed work.
A slice has one command, which can record several events, and one read model it defines.
A slice may read any number of views that other slices define.
`validate --profile eventmodeling` hints when one `@slice` name holds several read models, and warns when it holds several commands; the [rules reference](./RULES.md) explains each.

### Types

Parameters take an optional type: `signUp(name: text, age?: number, tags: list[text])`.
A type is free text.
The usual choices are `text`, `number`, `id`, `datetime`, `yesno`, `list[T]` and a name you define.

### Event naming

`event-naming: kebab | pascal | none` in the `system` block sets what `validate` expects.
`kebab` is the default and means `{aggregate}-{verb}`.
`pascal` accepts `AccountCreated`.
`none` turns the check off.

### Translation source

```text
carrier -> acceptShipment(shipmentId: id) @source(system="Carrier", version="v2")
  --[default]--> [shipment-accepted]
```

`@source(system, version)` on a command says which outside system, and which version of its contract, the command translates from.
The actor is the translator, declared in `system { external: carrier (translator) }`.
`validate` warns when `system` is missing.

### Reading a view

```text
view OpenInvoices(accountId: id) = [invoice-opened*(accountId)] => { invoiceId: id } @query(returns=list, spec="the open invoices of an account")
view Totals(accountId: id) = [invoice-opened*(accountId)] => { sum: number } @projection
```

`@query(returns, spec)` says how a view is read: `returns` is `one`, `list` or `page`, and `spec` is a line of plain words.
`@projection` marks a view that other parts of the model read and no screen ever shows.
`validate` warns when a `@projection` view has a `@trigger`, or a `@query` has another `returns` value.

A read that can find nothing the first time, such as a duplicate check before the first record, is marked `from [Existing(id) @optional]`.
`@optional` only belongs in `from`, never in `on`.

### Scenarios

```text
auditor -> failAudit(auditId: id)
  --[default]--> [audit-failed]
  scenario "Fail an audit" {
    Given an audit is in progress
    When the auditor presses Fail
    Then the audit is recorded as failed
  }
```

A `scenario "name" { ... }` block goes right after the command or view it checks, and there can be several.
It is for acceptance criteria and test material, written as Gherkin or in any other plain lines.
The body is kept exactly as written, apart from removing the common indentation, so brackets, quotes, colons and `#` are safe.
It ends at a line that holds only `}`.
A scenario outside a command or view, or one after a context block closes, is an error.

#### Scenarios as steps

A scenario can also be written as steps, which the tools can check.
Lowercase keywords, one step to a line:

```eventline
user -> pay(id) in Account(id)
  --[too poor]--> reject NO_FUNDS
  --[default]--> [paid { id }]
  scenario "refused when there is no money" {
    given [account-opened { id: 1 }]
    when pay(id: 1)
    then reject NO_FUNDS
  }
```

- `given [...]` lists events that already happened, and may repeat.
- `when command(...)` is exactly one command, the one the scenario sits under.
- `then [...]` lists the events it records, or `then reject CODE` names a rejection of that command.
- A scenario with a line shaped like that is read as steps. Anything else, such as `Given a user`, stays prose, kept exactly as written.
  Mixing the two in one scenario is an error.
- `validate` warns when a step scenario lacks `when` or `then`, runs a different command, names an event nobody records or reads, or expects an event or rejection the command does not have.
- A rejection covered by a `then reject CODE` step needs no word match in prose for `--profile slicerm`.
- Views and policies take prose scenarios for now.

`eventline-axi scenarios <file>` lists each scenario, what it checks and how many lines it has.
`validate` warns about an empty scenario or a repeated name under the same command or view.

### Linking diagrams

`eventline-axi diagram --links` turns a box into a link to the same thing in another diagram.
The links are derived: the system context opens the containers, a container opens its data flow and its place on the board, a shard opens the boundary it holds, and each of those opens the way back up.
`@link` on a command, view, policy or boundary replaces the derived links of that element, in every diagram where it appears:

```eventline
view Orders(orderId) = [order-placed*(orderId)] => { status: text }
  @link(to="containers", node="view:Orders", label="Where Orders is stored")
  @link(url="https://wiki.example.com/runbooks/orders")
```

- `to` is a diagram: `eventmodel`, `context`, `containers`, `dataflow`, `deployment` or `contextmap`.
  `node` is a box id on it, such as `view:Orders`, `cmd:postTweet`, `worker:mailer` or `api`; leave it out to open the whole diagram.
- `url` is an address instead, and `label` is the tooltip.
- A box with several links shows one arrow badge for each, and the box itself opens the first.
- `validate` warns about a link to a diagram or box that does not exist, or to a diagram the model cannot draw yet.

### Outside facts: deduplication and correlation keys

A command an outside system issues is a fact someone else recorded, and it can arrive twice.
`@dedupe(scanId)` on the command, view or policy that consumes it names the field that tells a repeat from a new one.
`@correlate(parcelRef)` names the field that ties the fact to something in your system.
Both can list several names, and both count as supplying those fields to the events and views that carry them.
`validate --profile eventmodeling` hints at an outside command that has neither.

### Accepting a finding, and open questions

`@accept(rule="many-events", reason="One fact told in two parts")` on a command, view, policy or boundary says the team knows a rule reports something there, and why.
The finding stays in the list with its reason, and its severity does not change.
`validate` warns about an `@accept` with no reason or an unknown rule, and notes one that accepts nothing.

`@hotspot("Does the guest lose the deposit?", kind=assumption, category=rule)` records something the model does not answer yet.
`kind` is `question` (the default), `assumption` or `request`; a request says what must change with `concerns="scenario"`.
`category` is `action`, `data`, `next`, `rule`, `example`, `view`, `who` or `time`, and `status` is `open` (the default) or `resolved`.
With `--profile eventmodeling` or `workshop`, an open hotspot is reported as a hint.

### Strings, comments and repeated blocks

- Inside a string, `\"` is a quote, `\\` is a backslash and `\n` is a line break.
- A comment starts at `//` when it begins a line or follows a space, so `https://example.com` and `db://host` are safe in values.
- A command written twice with the same actor and name is one command with more branches and facts.
  Each block keeps its own annotations, such as its own `@slice`, and the board draws one command.

### Conventions that need no syntax

These are plain attributes or annotations that tools can rely on.

- `ports: a, b` and `implements: a` on a context keep the ports a core declares and the ports an adapter implements.
  `validate` does not check them yet.
- `language: 1.2` in the `system` block records which version of the language wrote the file.
  A tool can refuse a file that names a newer one than it knows.
- `@description("...")` on a command or view holds free text.
  Events have no place for one.
