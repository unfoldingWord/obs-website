# Pointing the rest of the web at the canonical hubs

Issue [#18](https://github.com/unfoldingWord/obs-website/issues/18).

The hubs and story pages now exist, but search engines and answer engines
have been citing Door43, Bloom Library, unfoldingword.org, find.bible and
app-store listings for years. They will keep doing it until those properties
agree that `https://openbiblestories.org/l/{code}/` is the public canonical
URL for a translation. Almost none of that work is in this repository, which
is exactly why it needs a written checklist rather than a good intention.

## What the site already asserts

- Every hub and story page has a self-referencing canonical on the apex host,
  and no hub or story canonicalizes across languages.
- `sitemap-languages.xml` and `sitemap-stories.xml` carry every hub and story
  URL with a real `lastmod`.
- Each hub's JSON-LD `CreativeWork` links back out to the places the
  translation actually lives: `sameAs` holds its Door43 repo(s) and, where a
  release publishes one, that language's YouTube playlist. So the graph says
  "these are the same thing" from this side.
- `/llms.txt` lists every hub, and the markdown mirror of each language whose
  full text this build holds.

What is missing is the return link from each of those properties.

## Checklist

Anything unchecked is a real gap, not a formality. Where a change belongs to
another repository, open an issue there and link it back to #18.

- [ ] **Door43 OBS repositories.** The README / front matter of each
      `*_obs` repo, starting with `unfoldingWord/en_obs`, links to
      `https://openbiblestories.org/l/{code}/` as the official public page.
      This is the highest-leverage item on the list: Door43 is what models
      cite today.
- [ ] **Door43 reader pages** (`door43.org/u/...`, `live.door43.org`) carry a
      "Read on Open Bible Stories" link to the same hub. Whether these can
      emit a `rel=canonical` at all is a question for the Door43 team; a
      visible link is worth more than nothing.
- [ ] **unfoldingword.org/open-bible-stories/** links to the hubs and states
      the same language count as `/discover/` — the count on this site comes
      from the DCS catalog on every build, so the other page is the one that
      goes stale. Any number typed by hand somewhere else will disagree with
      the site sooner or later; link to `/discover/` instead of repeating it.
- [ ] **Play Store listing** for the OBS app links to the site, and the app's
      per-language content points at hubs where it can.
- [ ] **Bloom Library** OBS collections link to the hub for that language.
- [ ] **find.bible / FOBAI** entries for OBS translations use hub URLs.
- [ ] **YouTube**: each language playlist description names
      unfoldingWord Open Bible Stories and links to `/l/{code}/`. The site
      already links the playlist from the hub, so this closes the loop.
- [ ] **Wikidata item** for Open Bible Stories exists, with `official
      website` = `https://openbiblestories.org/`, publisher unfoldingWord,
      and licence CC BY-SA 4.0. Then add the item URL to
      `ORGANIZATION_SAME_AS` / the work node in `src/lib/jsonld.ts`.
- [ ] **Wikimedia Commons**: captions on the OBS illustrations name Open
      Bible Stories and link back when touched (the images are © Sweet
      Publishing under CC BY-SA 3.0 — keep that attribution intact).
- [ ] **One inbound link from a language Wikipedia article** per priority
      language. Community task, not a code task, and not something to
      astroturf: a link belongs in an article only where it is genuinely a
      source or an external resource.

## `sameAs` candidates that are NOT yet in the JSON-LD

`src/lib/jsonld.ts` deliberately lists only URLs whose identity is
confirmed — a wrong `sameAs` merges two entities in a knowledge graph and is
worse than an absent one. These look right but were not verifiable from the
build environment (no outbound access to them), so they are parked here
rather than shipped:

| Candidate | Add once verified |
| --- | --- |
| `https://unfoldingword.org/open-bible-stories/` | the work node's `sameAs` |
| `https://en.wikisource.org/wiki/Open_Bible_Stories` | confirm it is this work and is current, then the work node |
| The English YouTube playlist | the work node's `sameAs` (per-language playlists are already on each hub) |
| A Wikidata item, once created | `ORGANIZATION_SAME_AS` and the work node |

Verifying one is a two-minute job: open it, confirm it is this work and names
unfoldingWord, then add the line and note it here.

## How to tell whether this worked

The `url_cited` column of the quarterly sheet in
[`search-visibility.md`](search-visibility.md). If an answer engine names
Open Bible Stories but cites Door43 or a third-party mirror, the pages are
fine and this checklist is not done.
