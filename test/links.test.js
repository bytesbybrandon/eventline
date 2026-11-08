'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, check, render, linkMap, KINDS } = require('../lib');

const example = (name) => fs.readFileSync(path.join(__dirname, '..', 'examples', `${name}.dsl`), 'utf8');
const drawable = (model) => KINDS.filter((k) => { try { render(model, k); return true; } catch (e) { if (e.code) return false; throw e; } });
const ids = (svg) => new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));

for (const name of ['twitter-pure', 'billing', 'rate-limiter', 'payment-webhook']) {
  test(`every link in ${name} lands on a box that is drawn in the diagram it names`, () => {
    const model = parse(example(name));
    const kinds = drawable(model);
    const drawn = Object.fromEntries(kinds.map((k) => [k, ids(render(model, k, 'svg', 'dark', { links: true }))]));
    let seen = 0;
    for (const kind of kinds) {
      const svg = render(model, kind, 'svg', 'dark', { links: true });
      for (const [, href] of svg.matchAll(/class="lnk" href="([^"]+)"/g)) {
        const [file, node] = href.split('#');
        const target = file.replace(/\.svg$/, '');
        assert.ok(drawn[target], `${kind} links to ${target}, which this model does not draw`);
        if (node) assert.ok(drawn[target].has(decodeURIComponent(node)), `${kind} links to ${href}, but ${node} is not on the ${target}`);
        seen++;
      }
    }
    assert.ok(seen > 5, 'a real model has links between its diagrams');
  });
}

test('the drill-down follows the levels: context to containers, a container to its data flow and board, a shard to its boundary', () => {
  const map = linkMap(parse(example('twitter-pure')));
  assert.equal(map.context.sys[0].diagram, 'containers');
  assert.deepEqual(map.containers['view:UserTimeline'].map((t) => t.diagram), ['dataflow', 'eventmodel']);
  assert.equal(map.eventmodel['cmd:postTweet'][0].node, 'cmd:postTweet');
  assert.equal(map.deployment['us-primary:shard:TweetFeed'][0].node, 'bnd:TweetFeed');
  assert.equal(map.containers.sys[0].diagram, 'context', 'and back up');
});

test('without the links option no diagram carries a link, in any format', () => {
  const model = parse(example('twitter-pure'));
  assert.ok(!/<a /.test(render(model, 'containers', 'svg')));
  assert.ok(!/<a /.test(render(model, 'eventmodel', 'svg')));
  assert.ok(!/\bclick\b/.test(render(model, 'containers', 'mermaid')));
  assert.ok(!/URL=/.test(render(model, 'containers', 'dot')));
  assert.ok(/click n\d+ href "dataflow\.mmd#view:UserTimeline"/.test(render(model, 'containers', 'mermaid', 'light', { links: true })));
  assert.ok(/URL="dataflow\.dot#view:UserTimeline"/.test(render(model, 'containers', 'dot', 'light', { links: true })));
});

const MODEL = `system Shop { region: eu, us }
boundary Cart(cartId) @partition(shardKey="cartId")
user -> addItem(cartId) in Cart(cartId) @link(url="https://wiki.example.com/add-item")
  --[default]--> [item-added { cartId }]
view Cart(cartId) = [item-added*(cartId)] => { n: count(item-added*(cartId)) } @link(to="containers", node="api", label="Who reads this") @link(url="/runbooks/cart")
`;

test('@link replaces the derived links of its element, in every diagram where the element appears', () => {
  const map = linkMap(parse(MODEL));
  assert.deepEqual(map.eventmodel['cmd:addItem'], [{ diagram: null, node: null, label: 'https://wiki.example.com/add-item', url: 'https://wiki.example.com/add-item' }]);
  assert.deepEqual(map.eventmodel['view:Cart'].map((t) => t.label), ['Who reads this', '/runbooks/cart']);
  assert.deepEqual(map.dataflow['view:Cart'].map((t) => t.label), ['Who reads this', '/runbooks/cart']);
  const self = linkMap(parse(MODEL.replace('to="containers", node="api"', 'to="containers", node="view:Cart"')));
  assert.ok(!self.containers['view:Cart'].some((t) => t.node === 'view:Cart'), 'a box never links to itself');
  assert.equal(self.eventmodel['view:Cart'][0].node, 'view:Cart', 'but another diagram can link to it');
  const svg = render(parse(MODEL), 'eventmodel', 'svg', 'dark', { links: true });
  assert.match(svg, /href="https:\/\/wiki\.example\.com\/add-item"/);
});

test('check reports an @link that cannot work, and stays quiet about ones that do', () => {
  const rules = (text) => check(parse(text)).filter((i) => i.rule.startsWith('link')).map((i) => i.rule + ': ' + i.message);
  assert.deepEqual(rules(MODEL), []);
  assert.equal(rules(MODEL.replace('to="containers", node="api"', 'to="nonsense"')).length, 1);
  assert.equal(rules(MODEL.replace('node="api"', 'node="view:Nope"')).length, 1);
  assert.equal(rules(MODEL.replace('to="containers", node="api", label="Who reads this"', 'label="nowhere"')).length, 1);
  assert.equal(rules(MODEL.replace('url="/runbooks/cart"', 'url="ftp-ish"')).length, 1);
  assert.match(rules(MODEL.replace('region: eu, us', '').replace('to="containers", node="api"', 'to="deployment"'))[0], /cannot draw yet/);
});
