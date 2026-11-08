// An Expressive Code plugin: a model that parses and has a command, view or policy gets an "Open in playground" link.
import { definePlugin } from 'astro-expressive-code';
import { h } from 'astro-expressive-code/hast';
import { isDrawable, playgroundHref } from './eventline-source.mjs';

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
