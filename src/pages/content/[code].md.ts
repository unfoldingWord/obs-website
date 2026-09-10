import type { APIRoute } from 'astro';
import { mirroredLanguages, languageMarkdown, textResponse } from '../../lib/markdown';
import type { CatalogLanguage } from '../../data/catalog';

// One markdown file per language, holding that language's complete story
// text (#20). Built only for languages whose text is in this build, so the
// route cannot produce an empty mirror — and llms.txt names exactly the same
// set.
export function getStaticPaths() {
  return mirroredLanguages().map((lang) => ({ params: { code: lang.code }, props: { lang } }));
}

export const GET: APIRoute = async ({ props }) =>
  textResponse(await languageMarkdown(props.lang as CatalogLanguage), 'text/markdown; charset=utf-8');
