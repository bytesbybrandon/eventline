// Expressive Code options live here, not in astro.config.mjs, so the <Code> component can use them too.
import { readFileSync } from 'node:fs';
import { openInPlayground } from './src/code/open-in-playground.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const grammar = { ...json('./src/code/eventline.tmLanguage.json'), aliases: ['dsl'] };

export default {
  themes: [json('./src/code/theme-dark.json'), json('./src/code/theme-light.json')],
  shiki: { langs: [grammar] },
  plugins: [openInPlayground()],
  styleOverrides: {
    borderRadius: '10px',
    borderColor: 'var(--sl-color-hairline)',
    codeFontFamily: 'var(--sl-font-mono)',
    codeFontSize: '0.84rem',
    codeLineHeight: '1.7',
    codePaddingBlock: '1rem',
    codePaddingInline: '1.25rem',
    frames: { frameBoxShadowCssValue: false },
  },
};
