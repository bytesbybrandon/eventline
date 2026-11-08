'use strict';
// Reference converter: a SliceRM ProjectDoc (JSON) to an eventline model.
// Usage: node convert-slicerm.js <project.json> <out.dsl>
// Prints what the language cannot hold. Dump the JSON from slice-rm with sliceRmProject() (see DYAD-BRIEF.md).
const fs = require('fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node convert-slicerm.js <project.json> <out.dsl>'); process.exit(2); }
const d = JSON.parse(fs.readFileSync(input, 'utf8'));
const el = new Map(d.elements.map((e) => [e.id, e]));
const lane = new Map(d.lanes.map((l) => [l.id, l]));
const camel = (s) => s[0].toLowerCase() + s.slice(1);
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ');
const externals = new Set();
const typed = (fields) => fields.map((f) => `${f.name}: ${f.type}`).join(', ');
const lost = {};
const lose = (k, n = 1) => { lost[k] = (lost[k] || 0) + n; };

const bySlice = new Map();
for (const p of d.placements) { if (!bySlice.has(p.sliceId)) bySlice.set(p.sliceId, []); bySlice.get(p.sliceId).push(p); }
const storyOf = new Map();
for (const r of d.requirements) if (r.type === 'story') for (const l of r.links || []) storyOf.set(l.sliceId, r);

const actors = new Set();
const boundaries = new Map();
const perCtx = new Map(d.contexts.map((c) => [c.id, { views: [], cmds: [], pols: [], emitted: new Set() }]));
const seenViews = new Set();
const tagBoundary = (tag) => { const [root, key] = tag.split(':'); const name = root[0].toUpperCase() + root.slice(1); boundaries.set(name, key); return `${name}(${key})`; };
const payload = (e) => (e.fields.length ? ` { ${typed(e.fields)} }` : '');

for (const s of d.slices) {
  const bucket = perCtx.get(s.contextId);
  if (!bucket) { lose('slice without context'); continue; }
  const els = (bySlice.get(s.id) || []).map((p) => ({ p, e: el.get(p.elementId), l: lane.get(p.laneId) })).filter((x) => x.e);
  const by = (k) => els.filter((x) => x.e.kind === k);
  const cmd = by('command')[0];
  const events = by('event');
  const trig = by('screen')[0];
  const rm = by('readModel')[0];
  const story = storyOf.get(s.id);
  const ann = [];
  if (trig) ann.push(`@note("${q(`${trig.l ? trig.l.name : 'someone'} uses ${trig.e.name}`)}")`);
  ann.push(`@slice("${q(s.name)}")`);
  if (s.notes) ann.push(`@note("${q(s.notes)}")`);
  if (s.status === 'todo') ann.push('@planned');
  if (s.storage === 'state') ann.push(`@state(model="${q(s.stateModel || '')}", result="${q(s.stateResult || '')}")`);
  if (story) ann.push(`@story("${q(story.story)}")`);
  if (story && story.gherkin) lose('gherkin scenarios (multi-line)');
  if (s.pattern === 'view') {
    if (!rm || seenViews.has(rm.e.name)) continue;
    seenViews.add(rm.e.name);
    const srcs = rm.p.refs.filter((r) => r.relation === 'follows').map((r) => el.get(r.elementId)).filter((x) => x && x.kind === 'event');
    const qq = rm.e.query;
    const params = qq && qq.params.length ? typed(qq.params) : 'id: id';
    if (qq && qq.returns) lose('read-model query: returns cardinality');
    bucket.views.push(`  view ${rm.e.name}(${params}) = [${srcs.map((x) => x.name).join(', ') || 'unknown-source'}] => { ${typed(rm.e.fields) || 'value: text'} } ${ann.join(' ')}\n`);
    continue;
  }
  if (!cmd) continue;
  let actor = trig && trig.l ? trig.l.name : 'Services';
  if (s.pattern === 'translation') { const tr = by('translator')[0]; if (tr) { actor = tr.e.name; externals.add(actor); if (tr.e.source) ann.push(`@note("translates from ${q(tr.e.source.system)} ${q(tr.e.source.version)}")`); } }
  const emits = events.filter((x) => x.p.refs.some((r) => r.elementId === undefined ? false : r.elementId === cmd.e.id));
  const evs = emits.length ? emits : events.slice(0, 1);
  const tag = (evs[0] && evs[0].e.tags[0]) || null;
  const bnd = tag ? tagBoundary(tag) : null;
  evs.forEach((x) => bucket.emitted.add(x.e.name));
  const on = (s.evidence || []).map((id) => (el.get(id) || { name: id }).name);
  let t = '';
  if (s.pattern === 'automation') {
    const au = by('automation')[0];
    const rd = au && au.p.refs.filter((r) => r.relation === 'uses').map((r) => el.get(r.elementId)).filter(Boolean);
    actor = 'System';
    if (au && au.e.schedule) t += `  every ${au.e.schedule.every} ${au.e.schedule.unit}\n`;
    if (rd && rd.length) t += `  from [${rd.map((r) => r.name).join(', ')}]\n`;
    t += `    -> ${au.e.name} -> ${camel(cmd.e.name)}()\n`;
    bucket.pols.push(t + '\n');
    t = '';
  }
  if (!externals.has(actor)) actors.add(actor);
  t += `  ${actor} -> ${camel(cmd.e.name)}(${typed(cmd.e.fields)})${bnd ? ` in ${bnd}` : ''} ${ann.join(' ')}\n`;
  if (on.length) t += `  on [${on.join(', ')}]\n`;
  for (const r of cmd.e.rejections || []) t += `    --[${r.rule.replace(/[\[\]]/g, '')}]--> reject ${r.code}\n`;
  t += `    --[default]--> [${evs.map((x) => x.e.name + payload(x.e)).join(', ')}]\n`;
  bucket.cmds.push(t + '\n');
}

let dsl = `system SliceRM {\n  region: browser\n  event-naming: ${d.eventNaming && d.eventNaming.style === 'none' ? 'none' : 'pascal'}\n${externals.size ? `  external: ${[...externals].map((x) => `${x} (translator)`).join(', ')}\n` : ''}}\n\n`;
for (const a of actors) dsl += `actor ${a} { auth: session }\n`;
dsl += '\n';
for (const [n, k] of boundaries) dsl += `boundary ${n}(${k}) @partition(shardKey="${k}")\n`;
dsl += '\n';
for (const c of d.contexts) {
  const b = perCtx.get(c.id);
  const pub = (c.publishes || []).map((id) => (el.get(id) || { name: id }).name);
  dsl += `context ${c.name} {\n  description: ${c.description}\n${pub.length ? `  publishes: ${pub.join(', ')}\n` : ''}\n`;
  dsl += b.views.join('\n') + '\n' + b.cmds.join('') + b.pols.join('') + '}\n\n';
}
fs.writeFileSync(output, dsl);
lose('requirement hierarchy (epic>story)', d.requirements.filter((r) => r.type === 'epic').length);
lose('flows (story replay)', d.flows.length);
lose('plan levels/items', d.planItems.length);
console.log(JSON.stringify({ lines: dsl.split('\n').length, lost }, null, 1));
