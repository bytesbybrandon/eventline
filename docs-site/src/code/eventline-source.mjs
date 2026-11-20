// Decides which code blocks are eventline source (by shape) and which are whole models worth drawing (by the real parser).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'lib', 'index.js'));

const SHAPES = [
  /^\s*[A-Za-z_]\w*\s*->\s*\w+\(/m, // user -> postTweet(...)
  /--?\[[^\]]*\]--?>/, // a guard edge
  /^\s*(system|actor|boundary|view|readmodel|context|scenario)\s+[A-Za-z_"]/m,
  /^\s*policy\s+[A-Za-z_]\w*\s*=/m, // a named policy
  /^\s*event[ \t]+[A-Za-z_][\w-]*[ \t]*(\{|$)/m, // an event declaration
  /^\s*[a-z][a-z0-9]*(-[a-z0-9]+)+\*?\s*\{/m, // a policy trigger: event { ... }
  /^\s*(on|from)\s*\[/m, // the facts a command needs, or a policy that starts from a read model
  /@[a-z]+\(/, // an annotation
];

function parsed(text) {
  try { return lib.parse(text); } catch { return null; }
}

/* True when the block has the shape of eventline source, whole model or fragment. Highlighting is harmless on a fragment. */
/**
 * Whether a code block has the shape of eventline source.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(n·S) where n = characters, S = shape patterns (8) (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 15
 * - Branch Coverage: 100% measured; target >= 70%
 * - CRAP Score: 1.0 measured; threshold <= 25
 * - Caching: none
 */
export function looksLikeEventline(text) {
  return SHAPES.some((re) => re.test(text));
}

/* True when the block is a model worth drawing: it parses and holds a command, view or policy. */
/**
 * Whether a code block parses into a model worth drawing.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(parse) = O(n) where n = characters (derived by reading the code)
 * - Cyclomatic Complexity (CC): 3 measured; target <= 15
 * - Branch Coverage: 100% measured; target >= 70%
 * - CRAP Score: 3.0 measured; threshold <= 25
 * - Caching: none
 */
export function isDrawable(text) {
  const m = parsed(text);
  return !!m && m.commands.length + m.views.length + m.policies.length > 0 && text.split('\n').filter((l) => l.trim()).length >= 3;
}

/**
 * The playground address for a code block.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(n) where n = characters (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 15
 * - Branch Coverage: 100% measured; target >= 70%
 * - CRAP Score: 1.0 measured; threshold <= 25
 * - Caching: none
 */
export const playgroundHref = (text) => `/eventline/app/#play=${Buffer.from(text, 'utf8').toString('base64url')}`;
