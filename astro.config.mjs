import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// URL scheme matches churchbased.bible: English at /, every other locale at
// /{lang}/ — existing English URLs keep working unchanged.
export default defineConfig({
  site: 'https://openbiblestories.org',
  integrations: [sitemap()],
  devToolbar: { enabled: false },
  trailingSlash: 'always',

  // Keep the built HTML uncompressed so it stays diffable against the
  // original hand-written pages this site was migrated from.
  compressHTML: false,

  i18n: {
    defaultLocale: 'en',
    locales: [
      'en', 'es', 'fr', 'hi', 'ru', 'ar', 'zh', 'sw',
      'pt', 'id', 'vi', 'bn', 'ur', 'fa', 'my', 'nl',
    ],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
