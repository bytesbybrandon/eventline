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
      components: { Header: './src/components/Header.astro', PageTitle: './src/components/PageTitle.astro' },
      head: [
        // The landing page is dark, so the docs open dark. A visitor's own choice, once made, wins.
        { tag: 'script', content: "try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','dark')}catch(e){}" },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://bytesbybrandon.github.io/eventline/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'eventline, with a line of events streaming left to right' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://bytesbybrandon.github.io/eventline/og.png' } },
      ],
      plugins: [starlightLinksValidator()],
      lastUpdated: false,
      pagination: true,
      sidebar: [
        { label: 'Start here', items: ['index', 'event-modeling', 'language', 'examples', 'thinking-guide', 'glossary'] },
        { label: 'Model a system', items: ['actors', 'system-context', 'twitter-translation'] },
        { label: 'Use the tool', items: ['eventline-axi'] },
        { label: 'Interviews', items: ['interview-simulation'] },
        { label: 'Build with it', items: ['architecture', 'contributing'] },
      ],
    }),
  ],
});
