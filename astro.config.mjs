import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://openbiblestories.org',
  integrations: [sitemap()],
  // Keep the built HTML uncompressed so it stays diffable against the
  // original hand-written pages this site was migrated from.
  compressHTML: false,
});
