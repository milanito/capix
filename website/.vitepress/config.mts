import { defineConfig } from 'vitepress';

export default defineConfig({
  base:      process.env['VITEPRESS_BASE'] ?? '/',
  srcDir:    '../docs',
  outDir:    '../dist/website',
  cacheDir:  '../.vitepress-cache',

  // Links to package READMEs and benchmark source outside docs/ are valid in the
  // git repo but cannot be resolved by VitePress's static site generator.
  ignoreDeadLinks: [
    /\/packages\//,
    /\/benchmarks\//,
  ],

  title:       'Capix',
  description: 'A Node.js framework where you declare capabilities, not routes.',
  lang:        'en-US',

  head: [
    ['link', { rel: 'icon', href: `${process.env['VITEPRESS_BASE'] ?? '/'}favicon.svg`, type: 'image/svg+xml' }],
    ['meta', { name: 'theme-color', content: '#4f46e5' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Capix' }],
    ['meta', { property: 'og:description', content: 'Capabilities, not routes.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Capix',

    nav: [
      { text: 'Guide',       link: '/guide/introduction' },
      { text: 'Transports',  link: '/transports/overview' },
      { text: 'CLI',         link: '/cli' },
      { text: 'Patterns',    link: '/patterns/auth' },
      { text: 'Benchmarks',  link: '/benchmarks' },
      {
        text: 'v0.1.0-alpha.12',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'npm',       link: 'https://www.npmjs.com/package/@capixjs/core' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction',  link: '/guide/introduction' },
            { text: 'Quick Start',   link: '/guide/quick-start' },
            { text: 'Core Concepts', link: '/guide/concepts' },
          ],
        },
        {
          text: 'Core',
          items: [
            { text: 'Capabilities', link: '/guide/capabilities' },
            { text: 'Context',      link: '/guide/context' },
            { text: 'Guards',       link: '/guide/guards' },
            { text: 'Errors',       link: '/guide/errors' },
            { text: 'Enhancers',    link: '/guide/enhancers' },
            { text: 'Plugins',      link: '/guide/plugins' },
            { text: 'Testing',      link: '/guide/testing' },
          ],
        },
      ],
      '/transports/': [
        {
          text: 'Transports',
          items: [
            { text: 'Overview',   link: '/transports/overview' },
            { text: 'REST',       link: '/transports/rest' },
            { text: 'WebSocket',  link: '/transports/websocket' },
            { text: 'GraphQL',    link: '/transports/graphql' },
            { text: 'Queue',      link: '/transports/queue' },
          ],
        },
      ],
      '/patterns/': [
        {
          text: 'Patterns',
          items: [
            { text: 'Authentication',       link: '/patterns/auth' },
            { text: 'Composition',          link: '/patterns/composition' },
            { text: 'Real-time',            link: '/patterns/real-time' },
            { text: 'Background Jobs',      link: '/patterns/background-jobs' },
            { text: 'Multi-step Mutations', link: '/patterns/multi-step' },
            { text: 'Privacy',              link: '/patterns/privacy' },
          ],
        },
      ],
      '/migration/': [
        {
          text: 'Migration',
          items: [
            { text: 'From Express', link: '/migration/from-express' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'capix', link: '/api/index' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/milanito/capix' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message:   'Released under the MIT License.',
      copyright: 'Copyright © 2026 Capix Contributors',
    },

    editLink: {
      pattern: 'https://github.com/milanito/capix/edit/master/docs/:path',
      text:    'Edit this page on GitHub',
    },
  },
});
