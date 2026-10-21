import type { APIRoute } from 'astro';
import { languageCount, latestRelease } from '../../data/catalog';
import { SITE_URL, PRODUCT_NAME, DEFINITION, LICENSE_URL } from '../../lib/jsonld';

// A machine-readable summary of the site for answer engines that look for
// /ai/summary.json. Not a standard Google uses — the JSON-LD on every page is
// the real entity markup — so this only restates the same public facts
// (src/lib/jsonld.ts), generated from the same catalog on every build so it
// cannot drift from the pages.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: PRODUCT_NAME,
        alternateName: 'Open Bible Stories',
        description: DEFINITION,
        url: `${SITE_URL}/`,
        publisher: { name: 'unfoldingWord', url: 'https://unfoldingword.org/' },
        license: LICENSE_URL,
        isAccessibleForFree: true,
        stories: 50,
        publishedLanguages: languageCount,
        dateModified: latestRelease,
        links: {
          languages: `${SITE_URL}/discover/`,
          questions: `${SITE_URL}/contact/`,
          translate: `${SITE_URL}/translate/`,
          changelog: `${SITE_URL}/changelog/`,
          llms: `${SITE_URL}/llms.txt`,
          llmsFull: `${SITE_URL}/llms-full.txt`,
          sitemap: `${SITE_URL}/sitemap-index.xml`,
        },
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
