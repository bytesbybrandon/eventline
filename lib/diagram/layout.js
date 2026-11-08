'use strict';

/*
 * Layering shared by every diagram.
 *
 * Models contain real loops (a command reads a view fed by its own events, a
 * policy calls the command that triggered it). Layering needs a DAG, so edges
 * that close a loop are set aside as "back" edges: still drawn, never used to
 * place nodes. The choice is deterministic: roots are tried in the given order.
 */
function layering(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const back = new Set();
  for (const e of edges) {
    if (!out.has(e.from) || !out.has(e.to) || e.from === e.to) continue;
    // A weak edge is known feedback (a worker calling back into the API). It never places nodes.
    if (e.weak) { back.add(`${e.from}>${e.to}`); continue; }
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }

  const state = new Map();
  // (back is filled above for weak edges and below for cycle-closing edges)
  const post = [];
  const visit = (id) => {
    state.set(id, 1);
    for (const next of [...out.get(id)].reverse()) {
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
    post.push(id);
  };
  // Roots and children are walked in reverse so that reversing the post-order restores source order.
  for (const id of [...ids.filter((i) => indeg.get(i) === 0), ...ids].reverse()) if (!state.has(id)) visit(id);

  const topo = post.reverse();
  const forward = edges.filter((e) => e.from !== e.to && out.has(e.from) && out.has(e.to) && !back.has(`${e.from}>${e.to}`));
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const e of forward) { preds.get(e.to).push(e.from); succs.get(e.from).push(e.to); }

  const col = new Map();
  for (const id of topo) col.set(id, preds.get(id).reduce((m, p) => Math.max(m, col.get(p) + 1), 0));
  return { col, back, topo, preds, succs };
}

module.exports = { layering };
