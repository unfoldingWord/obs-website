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

- The canonical host serves the site and `www` 301s to it (#11 — verify in
  production, `curl -sI https://www.openbiblestories.org/library`).
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

`kind` matters when reading results, because the three fail for different
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
- **in-language** — deliberately blank. See the next section.

`url_cited` is the column that decides whether this work paid off: if an
answer engine cites `live.door43.org` or a third-party aggregator instead of
`openbiblestories.org/l/{code}/`, the pages exist but the canonical
signalling has not landed (#18).

## The rows a generator cannot write

The generator will not machine-translate query wording. A wrong phrase
measured for a quarter is worse than a blank one: it produces a confident
zero. Each language therefore gets one row marked
`in-language (TO BE WRITTEN BY A SPEAKER)`.

Filling those rows is the same conversation as the native review of the hub
strings — see [`native-review.md`](native-review.md) and #21. Two or three
phrases per language is enough: what a speaker would actually type for
"Bible stories", "Bible stories PDF" and "listen to Bible stories".

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

Sample size: ~30 prompts per priority language is enough to see a pattern;
the generator emits more rows than that per language, so trim rather than
add.

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
