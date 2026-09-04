import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { locales, defaultLocale } from './src/i18n/config';

// URL scheme matches churchbased.bible: English at /, every other locale at
// /{lang}/ — existing English URLs keep working unchanged.
export default defineConfig({
  site: 'https://openbiblestories.org',
  integrations: [
    sitemap({
      // Emits <xhtml:link rel="alternate" hreflang> for every locale of each
      // marketing page in the sitemap, mirroring the <link> tags Base.astro
      // puts in the HTML (hreflang "Graph A"). The BCP-47 tags must match
      // src/i18n/config.ts exactly.
      i18n: {
        defaultLocale,
        locales: Object.fromEntries(locales.map((l) => [l.code, l.tag])),
      },
      // The 404 page is served for missing URLs; it must not be listed as a
      // page in its own right.
      filter: (page) => !page.endsWith('/404/'),
    }),
  ],
  devToolbar: { enabled: false },
  trailingSlash: 'always',

  // Keep the built HTML uncompressed so it stays diffable against the
  // original hand-written pages this site was migrated from.
  compressHTML: false,

  i18n: {
    defaultLocale,
    locales: locales.map((l) => l.code),
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
