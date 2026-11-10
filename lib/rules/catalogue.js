'use strict';

/*
 * Every rule `check` can report, in one place. The reference page (docs/RULES.md) is generated from this
 * list, `eventline-axi rules` prints it, and a test fails if a rule reports an id that is not here.
 *
 *   profile   core: the language is wrong or inconsistent. Always on.
 *             workshop: the eventmodeling rules, every one reported as info. For exploring a model before it is meant to be right.
 *             eventmodeling: Event Modeling guidelines. Opt in with --profile eventmodeling.
 *             slicerm: stricter, for tools that treat a slice as one unit of delivery. Includes eventmodeling.
 *   severity  error: the model cannot mean what it says. warn: a gap that is almost always a mistake.
 *             info: worth a second look. `slicerm` may raise a rule's severity (see `slicerm`).
 *   category  the kind of thing that is wrong, so a tool can group findings.
 */

const CATEGORIES = {
  structure: 'A statement is missing something it needs',
  order: 'Things depend on each other in a way no order can satisfy',
  boundary: 'Consistency scopes and the edges between contexts',
  fields: 'Information that appears from nowhere',
  references: 'A name points at something that is not there',
  naming: 'Names that break the project convention',
  routes: 'How triggers reach commands and views',
  schedule: 'When timers fire',
  scenarios: 'Given, when, then examples',
  triggers: 'What a person or system uses to reach a command or view',
  links: 'Links between diagrams',
  slices: 'What belongs together in one unit of delivery',
  hints: 'Allowed, but often worth a second look',
};

const R = (id, profile, severity, category, title, why, fix, extra = {}) => ({ id, profile, severity, category, title, why, fix, ...extra });

const RULES = [
  // ---- core: the language itself ----
  R('on-facts', 'core', 'error', 'references', 'A view listed in on [...]', 'on [...] lists the events a command needs. A view is read with from [...], not on.', 'Move the view to from [...], or list the event the view is built from.'),
  R('from-facts', 'core', 'warn', 'references', 'Reads a view that is not declared', 'from [...] names a view that no view statement defines, so nothing says what it holds.', 'Declare the view, or fix the name.'),
  R('unknown-boundary', 'core', 'error', 'boundary', 'Command is in a boundary that is not declared', 'in Name(key) scopes a command to a boundary, and no boundary statement defines it.', 'Add boundary Name(key), or fix the name.'),
  R('view-from-view', 'core', 'error', 'references', 'A view projects from a view', 'Views are folds over events. A view cannot be built from another view.', 'List the events the second view needs, not the view.'),
  R('view-sources', 'core', 'warn', 'structure', 'A view has no source events', 'A view with no events folds nothing.', 'List the events it projects from between the brackets.'),
  R('no-events', 'core', 'warn', 'structure', 'A command never records an event', 'Every command records at least one event on its happy path, or nothing happened.', 'Add events to the --[default]--> branch.'),
  R('missing-default', 'core', 'warn', 'structure', 'A command has no default branch', 'The default branch is the happy path. Without it a reader cannot tell what success looks like.', 'Add --[default]--> [ ... ] as the last branch.'),
  R('default-rejects', 'core', 'warn', 'structure', 'The default branch refuses', 'The default branch should record events. A refusal belongs on a guarded branch.', 'Put the refusal on a --[guard]--> reject CODE branch.'),
  R('rejection-as-event', 'core', 'info', 'structure', 'A rejection written as an event', 'An event named ...-rejected usually means nothing was recorded, and then it is a refusal, not an event.', 'Write --[guard]--> reject CODE when nothing is recorded.'),
  R('optional-on', 'core', 'warn', 'references', 'An on fact marked optional', 'Only from [...] reads can come back empty. A fact in on [...] must have happened.', 'Move it to from [...] or drop @optional.'),
  R('command-inputs', 'core', 'info', 'structure', 'A command lists no facts it needs', 'Fine for a command that starts something. Worth a look for one that should depend on what happened before.', 'Add on [...] or from [...], or leave it if the command creates something.'),
  R('command-boundary', 'core', 'info', 'boundary', 'A command does not say which boundary it is in', 'When the model has boundaries, each command should say which one its decision is scoped to.', 'Add in BoundaryName(key).'),
  R('boundaries', 'core', 'info', 'boundary', 'No boundary declared', 'Commands have no stated consistency scope.', 'Add boundary Name(key) and put commands in it.'),
  R('unknown-actor', 'core', 'info', 'references', 'A command actor is not declared', 'The actor is neither a declared actor nor a system external.', 'Declare it with actor Name { ... } or list it under external in the system block.'),
  R('freshness', 'core', 'info', 'references', 'A view is read without a freshness stance', 'A command that reads a view decides on something that may be stale.', 'Add @fresh<10s>, @eventual or @strong to the fact.'),
  R('policy-guard', 'core', 'info', 'structure', 'A policy rule has no guard', 'An event-triggered rule with no guard runs on every occurrence.', 'Add --[condition]--> or leave it if that is intended.'),
  R('unpublished-event', 'core', 'warn', 'boundary', 'An event crosses a context without being published', 'A context reads an event another context records but does not list in publishes.', 'Add the event to publishes of the context that records it, or stop reading it.'),
  R('assumed-events', 'core', 'info', 'references', 'Events nothing records', 'No command or policy records these, so the model assumes the facts exist.', 'Fine for facts from outside. Otherwise add the command that records them.'),
  R('event-naming', 'core', 'warn', 'naming', 'An event name breaks the convention', 'The system block sets event-naming (kebab or pascal) and this event does not follow it.', 'Rename the event, or set event-naming: none.'),
  R('query-returns', 'core', 'warn', 'structure', '@query returns is not one, list or page', 'The cardinality of a query has three values.', 'Use returns=one, list or page.'),
  R('projection-trigger', 'core', 'warn', 'triggers', 'A projection with a trigger', 'A @projection is never shown, so nothing reaches it through a screen or endpoint.', 'Remove @trigger or @projection.'),
  R('source-system', 'core', 'warn', 'structure', '@source has no system', 'A translation says where it comes from.', 'Add system="Name" to @source.'),
  R('command-trigger', 'core', 'info', 'triggers', 'A command does not say what is used to reach it', 'Other commands in the model say. This one does not, and no policy calls it.', 'Add @trigger(type=ui, name="...").'),
  R('trigger-name', 'core', 'warn', 'triggers', 'A trigger has no name', 'A @trigger names the screen, endpoint, command or agent.', 'Add name="..."'),
  R('trigger-type', 'core', 'warn', 'triggers', 'A trigger has an unknown type', 'Types are ui, endpoint, cli and agent.', 'Use one of them.'),
  R('trigger-route', 'core', 'warn', 'routes', 'A trigger route is not METHOD /path', 'Only ui and endpoint triggers have a route, written as METHOD /path.', 'Write route="POST /audits/{id}/fail", or drop it.'),
  R('scenario-name', 'core', 'warn', 'scenarios', 'A scenario has no name', 'Names make scenarios findable.', 'Name it: scenario "name" {'),
  R('scenario-empty', 'core', 'warn', 'scenarios', 'A scenario has no lines', 'An empty scenario checks nothing.', 'Add its Given, When and Then lines.'),
  R('scenario-duplicate', 'core', 'warn', 'scenarios', 'Two scenarios share a name under one command or view', 'Names must tell scenarios apart.', 'Rename one.'),
  R('link-target', 'core', 'warn', 'links', 'An @link cannot work', 'It names a diagram or box that is not there, or none at all, or a diagram this model cannot draw yet.', 'Check to= and node= against the diagram.'),
  R('link-url', 'core', 'warn', 'links', 'An @link url is not an address', 'A url is an http(s) address or a path.', 'Write https://... or a path.'),
  R('schedule-invalid', 'core', 'warn', 'schedule', 'A timer cannot fire', 'An interval needs a whole number above zero. A cron expression has five fields, each in range.', 'Write every 5 minutes, or cron "0 9 * * 1" (minute hour day-of-month month day-of-week).',
    { example: { bad: 'every 0 minutes\n  -> reminder -> sendReminder()', good: 'every 5 minutes\n  -> reminder -> sendReminder()' } }),

  R('accept-invalid', 'core', 'warn', 'structure', 'An @accept that cannot work', 'An @accept says the team knowingly keeps something a rule reports, and why. It needs rule="..." naming a rule in the catalogue, and a reason.', 'Write @accept(rule="many-events", reason="One fact told in two parts").'),
  R('accept-unused', 'core', 'info', 'hints', 'An @accept that accepts nothing', 'The rule it names reports nothing on this statement, so the acceptance is out of date or on the wrong statement.', 'Remove it, or move it to the statement the rule reports on.'),
  R('hotspot-invalid', 'core', 'warn', 'structure', 'A @hotspot that cannot work', 'A hotspot is an open question: @hotspot("text") with an optional kind (question, assumption, request), category (action, data, next, rule, example, view, who, time) and status (open, resolved). A request says what must change with concerns="...".', 'Write @hotspot("Does the guest lose the deposit?", kind=assumption, category=rule).'),
  R('hotspot-open', 'eventmodeling', 'info', 'hints', 'A hotspot is still open', 'Someone wrote down something the model does not answer yet.', 'Answer it in the model, then set status=resolved, or keep it as a known gap.'),

  // ---- eventmodeling: the guidelines ----
  R('unsourced-event-field', 'eventmodeling', 'warn', 'fields', 'An event carries a field nothing supplies', 'Information flows one way. An event can only hold what its command was given: its parameters, the boundary key, the facts it needs, or a value it computes.', 'Add the field to the command, to a fact it needs, or compute it with name: expression.',
    { example: { bad: 'user -> addItem(cartId) in Cart(cartId)\n  --[default]--> [item-added { cartId, sku }]', good: 'user -> addItem(cartId, sku) in Cart(cartId)\n  --[default]--> [item-added { cartId, sku }]' } }),
  R('unsourced-view-field', 'eventmodeling', 'warn', 'fields', 'A view shows a field no event carries', 'A view is a fold over events, so every plain field must be in the payload of an event it projects from. Computed fields are exempt.', 'Add the field to an event it reads, or compute it, as in total: count(order-placed*(id)).',
    { example: { bad: 'user -> addItem(cartId, sku)\n  --[default]--> [item-added { cartId, sku }]\nview Cart(cartId) = [item-added*(cartId)] => { cartId, total }', good: 'user -> addItem(cartId, sku)\n  --[default]--> [item-added { cartId, sku }]\nview Cart(cartId) = [item-added*(cartId)] => { cartId, items: count(item-added*(cartId)) }' } }),
  R('dependency-cycle', 'eventmodeling', 'warn', 'order', 'Commands depend on each other in a loop', 'Commands wait for events that others record. If they wait on each other in a loop, no order of work can start. A command that reads events it records itself is fine: that is how a decision checks what already happened.', 'Break the loop with an event that does not depend on the others, or mark one fact as coming from outside.'),
  R('slice-multiple-commands', 'eventmodeling', 'warn', 'slices', 'One slice holds several commands', 'A write slice has one command. A command can record several events. Two commands are two slices.', 'Give each command its own @slice name.'),
  R('slice-multiple-views', 'eventmodeling', 'info', 'slices', 'One slice defines several read models', 'A slice owns one query. Several read models in one slice invite several queries where one shaped for the reader would do. Reading views that other slices define is always fine.', 'Fold them into one view shaped for how it is read, or give each its own @slice.', { slicerm: 'warn' }),
  R('slice-no-scenario', 'eventmodeling', 'info', 'scenarios', 'Commands and views have no scenario', 'A slice is specified with a given, when, then example. This counts the commands and views that have none. Models that keep scenarios elsewhere can ignore it.', 'Add scenario "name" { ... } under the command or view.'),
  R('many-events', 'eventmodeling', 'info', 'hints', 'A happy path records several events', 'Right when they are one fact told in parts. If they are two steps, a policy can take the second.', 'Keep them if they are one fact, otherwise split the second into a policy.'),
  R('view-many-sources', 'eventmodeling', 'info', 'hints', 'Four or more events feed one view', 'Combining streams is fine, but each event ties the view to the command that records it, so fewer is easier to change.', 'Check that every source is needed.'),

  // ---- slicerm: stricter, for tools where a slice is a unit of delivery ----
  R('rejection-uncovered', 'slicerm', 'warn', 'scenarios', 'A rejection code has no scenario', 'Each way a command can refuse is a behaviour to specify. Only checked when the model has scenarios at all.', 'Add a scenario whose text names the code.'),
  R('route-duplicate', 'slicerm', 'warn', 'routes', 'Two commands or views share a method and route', 'One route in one context should reach one thing. Two triggers reaching the same command are fine.', 'Give one of them its own route.'),
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));
const PROFILES = ['core', 'workshop', 'eventmodeling', 'slicerm'];

module.exports = { RULES, BY_ID, CATEGORIES, PROFILES };
