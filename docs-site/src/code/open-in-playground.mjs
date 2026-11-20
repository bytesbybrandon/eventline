// An Expressive Code plugin: a model that parses and has a command, view or policy gets an "Open in playground" link.
import { definePlugin } from 'astro-expressive-code';
import { h } from 'astro-expressive-code/hast';
import { isDrawable, playgroundHref } from './eventline-source.mjs';

/**
 * Expressive Code plugin adding an "Open in playground" link.
 *
 * # Performance & Risk Budget
 * - Tier: P2 (< 2 s)
 * - Complexity: O(1) to create; O(parse) per eventline block (derived by reading the code)
 * - Cyclomatic Complexity (CC): 1 measured; target <= 15
 * - Branch Coverage: 0% measured (no test loads this file); target >= 70%
 * - CRAP Score: 2.0 measured; threshold <= 25
 * - Largest nested function: CC 3 measured (branch cov 0%, CRAP 12.0), `postprocessRenderedBlock: ({ codeBlock, renderData }) =>`
 * - Caching: none
 */
export function openInPlayground() {
  return definePlugin({
    name: 'Open in playground',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        if (codeBlock.language !== 'eventline' || !isDrawable(codeBlock.code)) return;
        const link = h('a.pg-link', { href: playgroundHref(codeBlock.code) }, [
          h('span.pg-link__mark', { 'aria-hidden': 'true' }),
          'Open in playground',
        ]);
        renderData.blockAst.children.push(link);
      },
    },
  });
}
