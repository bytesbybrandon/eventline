import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  site: 'https://bytesbybrandon.github.io',
  base: '/eventline/docs',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'eventline',
      description: 'A small notation for event-driven systems: commands, events, views and policies.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/bytesbybrandon/eventline' }],
      customCss: ['./src/styles/theme.css'],
      plugins: [starlightLinksValidator()],
      lastUpdated: false,
      pagination: true,
      sidebar: [
        { label: 'Start here', items: ['index', 'language', 'examples', 'thinking-guide', 'glossary'] },
        { label: 'Model a system', items: ['actors', 'system-context', 'twitter-translation'] },
        { label: 'Use the tool', items: ['eventline-axi'] },
        { label: 'Interviews', items: ['interview-simulation'] },
        { label: 'Build with it', items: ['architecture', 'contributing'] },
      ],
    }),
  ],
});
