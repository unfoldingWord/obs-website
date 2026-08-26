import { defineConfig } from 'astro/config';

export default defineConfig({
  // Keep the built HTML uncompressed so it stays diffable against the
  // original hand-written pages this site was migrated from.
  compressHTML: false,
});
