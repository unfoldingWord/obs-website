# Measuring search and generative visibility

Issue [#19](https://github.com/unfoldingWord/obs-website/issues/19).

There is no point in shipping 214 language hubs and ~9,000 story pages if
nobody can tell afterwards whether they are found. This is the measurement
setup: what to verify once, what to check every quarter, and where the
numbers live.

**None of this is in the repository, on purpose.** Search Console properties,
Bing verification and the results log are accounts and documents, not code.
What the repo owns is the *generator* (`npm run baseline`) and this file.

## What must be true before measuring

- The canonical host is the bare domain, and `www` 301s to it. Both
  hostnames are attached to the Pages project, so the rule fires; spot-check
  after a deploy with `curl -sI https://www.openbiblestories.org/library`
  (expect `301` to the apex `/discover/`).
- The served `robots.txt` matches `public/robots.txt`, i.e. the Cloudflare
  managed AI blocklist does not `Disallow: /` the retrieval agents (#15).
  Measuring ChatGPT or Perplexity citation while their fetchers are blocked
  measures the block, not the site.
- `npm run build && npm run check:routes` is green, so every URL in the
  sitemap index and in `/llms.txt` resolves.

## One-time setup

| Step | Where | Done when |
| --- | --- | --- |
| Google Search Console property on `https://openbiblestories.org` (domain property, DNS-verified) | search.google.com/search-console | Property exists, no host mismatch warning |
| Submit `https://openbiblestories.org/sitemap-index.xml` | Search Console → Sitemaps | Fetch succeeds; the four child sitemaps are discovered |
| Bing Webmaster Tools, same host, same sitemap index | bing.com/webmasters | Fetch succeeds |
| Record the account and the owner of each property | the internal tracker below | A second person can get in |

Bing matters beyond Bing: Copilot is grounded in it, and other answer
engines have historically used it as a source.

## What to watch in Search Console

Weekly for the first month after a launch, then monthly:

- **Pages → Not indexed → "Crawled – currently not indexed."** This is the
  expected failure mode for ~9,000 story pages that differ only by language.
  A rising count on `/l/*/story-*` means the story pages are being treated as
  thin duplicates; a rising count on `/l/*/` (hubs) is more serious.
- **Sitemaps → discovered vs indexed** per child sitemap, so hubs and stories
  can be told apart.
- **Performance → Queries, filtered by page group.** Split
  `openbiblestories.org/l/` from the marketing pages: brand queries on the
  marketing pages tell us nothing about whether Bhojpuri readers find the
  Bhojpuri hub.
- **Performance → Countries**, as a proxy for whether the hubs reach the
  places their languages are spoken.

Track queries **per language, not only English brand terms**. `Open Bible
Stories` ranking first is not the goal; `hadithi za biblia`, `historias
bíblicas PDF`, `قصص الكتاب المقدس` and `बाइबल की कहानियाँ` are.

## Reading a coverage export

The Page-indexing export (Search Console → Pages → Export) has four tabs and
gives **counts per reason, not URLs**. To act on anything you almost always
need the per-issue export instead: click the reason row, then Export — that
sheet has the `examples` list. Ask for that one.

What each reason means for this site, and whether it is ours to fix:

| Reason | Actionable? | What it means here |
| --- | --- | --- |
| **Not found (404)** | **Yes, always** | A URL Google knows about serves 404. On a site whose routes change, this is nearly always a retired route with no redirect. `npm run check:routes` now fails on one (see below), so a fresh 404 means a route was retired outside that list, or an external link points somewhere that never existed. |
| **Page with redirect** | **Usually no** | Informational. The URL is excluded from the index *because it redirects*, which is the correct outcome for a retired URL. `/library`, `/features/`, `/resources/`, `/sitemap-0.xml` and the trailing-slash normalisations all land here by design. Only worth investigating if the count jumps, or if a URL you expect to be indexed appears — that would mean a canonical or trailing-slash mistake. |
| **Crawled – currently not indexed** | Rarely | Google crawled it and chose not to index it. No code change forces indexing. Watch *which* URLs: see the section above on story pages vs hubs. |
| **Alternate page with proper canonical tag** | No | Working as intended: the locale variants pointing at their canonical. |
| **Discovered – currently not indexed** | Sometimes | Usually crawl budget. The lever is the sitemap index being submitted and internal links to the page, not markup. |

**The 2026-09-10 reading, for reference.** 27 indexed, 16 not indexed, ~230
impressions/day: 11 "Page with redirect" (by design, no action), 2
"Not found (404)", 3 "Crawled – currently not indexed", 0 "Alternate page".

The two 404s traced to a real defect. `git log --diff-filter=D -- 'src/pages/**'`
showed `discover/read/index.astro` and `[lang]/discover/read.astro` deleted in
`d39c5eb` — the release then in production — so `/discover/read/` and
`/{locale}/discover/read/`, 17 URLs that had been live, started serving 404
with no redirect rule. Fixed with 301s to the locale's own Discover page.

Note the shape of that mistake, because it is the one to watch for: **retiring
a route is a two-part change**, and the second part leaves no trace in the
build. `dist/` cannot tell you that a URL used to exist, so nothing failed.
`check:routes` now carries an explicit `RETIRED` list with the commit each
entry came from, and asserts every one of them matches a `_redirects` rule
with a 301, that every redirect target was actually built, and that no
redirect points at another redirect. **Add to that list whenever a public
route is retired** — that is the whole guard.

Only 43 URLs were known to Google at all on that date, against a site that
serves ~9,400. That is a discovery problem, not an indexing one, and the lever
is the one-time setup above: the sitemap index has to be submitted.

## The baseline sheet

```
npm run baseline                        # priority languages, to stdout
npm run baseline -- --out=baseline.csv  # write a file
npm run baseline -- --all               # every published language
npm run baseline -- sw ha or            # named languages
```

Columns: `language_code, autonym, english_name, hub_url, kind,
query_or_prompt, surface, date_checked, obs_appears, position_or_cited,
url_cited, notes`.

`kind` matters when reading results, because these fail for different
reasons:

- **brand** (`Open Bible Stories Hausa`) — failing means the hub is not
  indexed at all.
- **descriptive** (`Bible stories in Hausa`) — failing means the hub is
  indexed but does not read as what it is.
- **exonym** — older or alternate names from the catalog, which is how many
  people still search.
- **format** (`Hausa Bible stories PDF download`) — failing means the file
  exists and is undiscoverable.
- **prompt** — the wording someone gives an answer engine.
- **in-language** — six deliberately blank rows per language, each labelled
  with the intent it is for. See the next section.

`url_cited` is the column that decides whether this work paid off: if an
answer engine cites `live.door43.org` or a third-party aggregator instead of
`openbiblestories.org/l/{code}/`, the pages exist but the canonical
signalling has not landed (#18).

## The rows a generator cannot write

The generator will not machine-translate query wording. A wrong phrase
measured for a quarter is worse than a blank one: it produces a confident
zero. Each language therefore gets six blank rows, each labelled with the
intent it is for: `in-language (TO BE WRITTEN BY A SPEAKER: listen to Bible
stories)` and so on.

Filling those rows is the same conversation as the native review of the hub
strings — see [`native-review.md`](native-review.md) and #21. The sheet has
**six** such rows per language, each labelled with its intent: "Bible
stories", "Bible stories PDF or printable", "listen to Bible stories",
"Bible stories for children", how they would ask an assistant for them, and
the name people actually use for the language.

## Quarterly generative check

Once a quarter, and again whenever a new hub language ships:

1. `npm run baseline -- --out=YYYY-QN.csv` (the query set is regenerated
   from the current catalog, so new languages appear on their own).
2. Ask each `prompt` row on ChatGPT, Gemini, Perplexity and Copilot, in a
   logged-out or fresh session. Personalisation makes a signed-in session
   unrepeatable.
3. Record `obs_appears` (yes/no), `position_or_cited`, and the exact
   `url_cited`.
4. Diff against the previous quarter and note what changed in the repo
   between them — a link to the PR is enough. Without that, a movement is
   uninterpretable.

Sample size, stated exactly, because the arithmetic matters and an
undersized baseline reads as a confident zero:

| Per priority language | Distinct rows |
| --- | --- |
| `prompt` rows the generator writes | 13–14 (two are gated on the language having audio or video, one on it having a distinct autonym) |
| `brand` / `descriptive` / `exonym` / `format` query rows | 6–9, depending on alternate names and formats |
| **Generated total** | **19–23** (measured: ar and id 19, sw and es-419 20, hi 22, en 23) |
| `in-language` blanks the generator leaves for a speaker | 6 |
| **Sheet total once filled in** | **25–29** |

So #19's "~30 prompts per priority language" is reached only once the six
in-language rows are written; the generator alone stops at 19–23, and it is
not meant to guess the rest. Each row is then observed on all six surfaces,
so ~30 distinct prompts is ~180 observations — do not report the second
number as the sample size.

## Freshness

Answer engines and search both favour sources that visibly move. Two things
already give this for free and should not be dropped:

- `lastmod` in `sitemap-languages.xml` / `sitemap-stories.xml` comes from the
  real release date of the translation.
- The catalog is re-fetched on every build, so a newly published language
  appears on the site — and in `/llms.txt` — without anyone editing a file.

What is still missing is a **public changelog of newly published languages**.
A short dated list, one line per language, is the cheapest freshness signal
this site can emit and the most useful one for a partner deciding whether to
link. Not yet built; tracked in #19.

## Where the tracker lives

The generated CSVs and the quarterly results are not in this repository.
Keep them in the unfoldingWord Google Drive alongside the other program
trackers, in one folder:

```
unfoldingWord / Program / OBS website / search-visibility/
  README (who owns the Search Console + Bing properties)
  baseline-YYYY-QN.csv        one per quarter, generated then filled
  notes-YYYY-QN.md            what changed in the repo that quarter
```

Fill the folder link and the property owners in below, and keep it here
rather than in a chat thread — this file is the entry point:

- Search Console property owner: _to fill in_
- Bing Webmaster Tools owner: _to fill in_
- Tracker folder: _to fill in_
