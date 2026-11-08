// Decides which code blocks are eventline source (by shape) and which are whole models worth drawing (by the real parser).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'lib', 'index.js'));

const SHAPES = [
  /^\s*[A-Za-z_]\w*\s*->\s*\w+\(/m, // user -> postTweet(...)
  /--\[[^\]]*\]-->/, // a guard edge
  /^\s*(system|actor|boundary|view|context|scenario)\s+[A-Za-z_"]/m,
  /^\s*[a-z][a-z0-9]*(-[a-z0-9]+)+\*?\s*\{/m, // a policy trigger: event { ... }
  /^\s*(on|from)\s*\[/m, // the facts a command needs
  /@[a-z]+\(/, // an annotation
];

function parsed(text) {
  try { return lib.parse(text); } catch { return null; }
}

/* True when the block has the shape of eventline source, whole model or fragment. Highlighting is harmless on a fragment. */
export function looksLikeEventline(text) {
  return SHAPES.some((re) => re.test(text));
}

/* True when the block is a model worth drawing: it parses and holds a command, view or policy. */
export function isDrawable(text) {
  const m = parsed(text);
  return !!m && m.commands.length + m.views.length + m.policies.length > 0 && text.split('\n').filter((l) => l.trim()).length >= 3;
}

export const playgroundHref = (text) => `/eventline/#play=${Buffer.from(text, 'utf8').toString('base64url')}`;
