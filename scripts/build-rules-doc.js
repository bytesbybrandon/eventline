'use strict';

/* Writes docs/RULES.md from lib/rules/catalogue.js, so the reference never drifts from the rules.
 * Run it after changing the catalogue: node scripts/build-rules-doc.js */
const fs = require('fs');
const path = require('path');
const { RULES, CATEGORIES } = require('../lib/rules');

const sentences = (text) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).join('\n');
const SECTIONS = [
  ['core', 'Core rules', 'These are always on.\nThey report a language that is wrong or inconsistent: a statement that cannot mean what it says.'],
  ['eventmodeling', 'Event Modeling rules', 'These apply the Event Modeling guidelines.\nTurn them on with `--profile eventmodeling`.\nThey check that information has a source, that work has an order, and that a slice holds what a slice should.'],
  ['slicerm', 'Stricter rules', 'These are for tools where a slice is one unit of delivery, such as SliceRM.\nTurn them on with `--profile slicerm`, which includes the Event Modeling rules.\nThe profile also raises a few Event Modeling rules from a hint to a warning.'],
];

function render() {
  const out = [];
  out.push('# Validation rules', '');
  out.push('`eventline-axi validate` checks a model against these rules, and `check(model, { profile })` does the same in code.');
  out.push('Each finding says what is wrong, where, and why it matters.', '');
  out.push('## Profiles', '');
  out.push('| Profile | Includes | Use it when |');
  out.push('| :--- | :--- | :--- |');
  out.push('| `core` (default) | the language rules | You want to know the file is sound |');
  out.push('| `eventmodeling` | core, plus the guidelines | You are designing a system and want the method checked |');
  out.push('| `slicerm` | eventmodeling, stricter | A slice is a unit of delivery that someone plans and builds |');
  out.push('');
  out.push('```bash');
  out.push('npx -y eventline-axi validate model.dsl --profile eventmodeling');
  out.push('npx -y eventline-axi rules --profile slicerm');
  out.push('```', '');
  out.push('## What a finding holds', '');
  out.push('| Field | Meaning |');
  out.push('| :--- | :--- |');
  out.push('| `severity` | `error` cannot mean what it says, `warn` is almost always a mistake, `info` is worth a second look |');
  out.push('| `rule`, `category`, `profile` | which rule, what kind of problem, and which profile it belongs to |');
  out.push('| `line`, `endLine` | where it starts and ends in the file |');
  out.push('| `subject` | the command, view, policy or boundary it is about, with its own `line` and `endLine` |');
  out.push('| `slice` | the `@slice` name of that statement, when it has one |');
  out.push('| `docs` | the link to this page |');
  out.push('');
  out.push('## Categories', '');
  out.push('| Category | What it covers |');
  out.push('| :--- | :--- |');
  for (const [id, text] of Object.entries(CATEGORIES)) out.push(`| \`${id}\` | ${text} |`);
  out.push('');
  for (const [profile, title, intro] of SECTIONS) {
    out.push(`## ${title}`, '');
    out.push(intro, '');
    for (const r of RULES.filter((x) => x.profile === profile)) {
      out.push(`### ${r.id}`, '');
      out.push(`**${r.title}.**`);
      out.push(`Severity: ${r.slicerm ? `${r.severity}, ${r.slicerm} with \`--profile slicerm\`` : r.severity}.`);
      out.push(`Category: ${r.category}.`, '');
      out.push(sentences(r.why), '');
      out.push(`How to fix it: ${sentences(r.fix).replace(/\n/g, '\n')}`, '');
      if (r.example) {
        out.push('Instead of:', '', '```text', r.example.bad, '```', '', 'write:', '', '```text', r.example.good, '```', '');
      }
    }
  }
  return out.join('\n');
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'RULES.md'), render());
  console.log('docs/RULES.md written from lib/rules/catalogue.js');
}

module.exports = { render };
