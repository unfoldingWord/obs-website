// Everything the hub's reader needs, per language, served from this site.
//
// The build already has every story's text — it is what the story pages are
// rendered from — so the reader has no reason to re-download it from Door43
// story by story. Reading one story used to cost a catalog lookup, a repo
// listing, 50 title fetches and a fetch per story viewed; it is now one
// same-origin request, which also means the reader keeps working when Door43
// is unreachable.
//
// Emitted only for languages whose story text is in this build (hasStories),
// so a Door43 outage during a build yields no endpoint rather than an empty
// one, and reader.js falls back to its original live-catalog path.
import type { APIRoute } from 'astro';
import { languages, type CatalogLanguage } from '../../../data/catalog';
import { storiesFor, hasStories } from '../../../data/stories';

export function getStaticPaths() {
  return languages
    .filter((lang) => hasStories(lang.code) && (lang.storyNums ?? []).length)
    .map((lang) => ({ params: { code: lang.code }, props: { lang } }));
}

export const GET: APIRoute = async ({ props }) => {
  const lang = (props as { lang: CatalogLanguage }).lang;
  const stories = await storiesFor(lang.code);

  // The entry these stories were read from — the reader needs its identity to
  // know when a publisher switch means falling back to the live fetch.
  const primary = lang.entries[0];

  return new Response(
    JSON.stringify({
      code: lang.code,
      direction: lang.direction,
      primary: primary ? { owner: primary.owner, name: primary.name } : null,
      // Enough of each catalog entry for the reader to render without asking
      // Door43 who publishes this language: the same fields the live catalog
      // search would have given it.
      entries: lang.entries.map((e) => ({
        owner: e.owner,
        name: e.name,
        branch_or_tag_name: e.branch_or_tag_name,
        metadata_type: e.metadata_type,
        title: e.title,
        language: lang.code,
        language_title: lang.title,
        language_direction: lang.direction,
        contentPath: e.contentPath,
      })),
      stories: stories.map((s) => ({
        num: s.num,
        title: s.title,
        reference: s.reference,
        audio: s.audio,
        frames: s.frames,
      })),
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Same policy as the HTML: a story only changes when a build deploys.
        'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
      },
    }
  );
};
