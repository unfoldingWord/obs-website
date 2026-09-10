# Native review of the interface strings

Issue [#21](https://github.com/unfoldingWord/obs-website/issues/21).

Every acceptance criterion on #21 that code can meet is met: the hubs carry
autonym, English name, alternate names, region and codes; the format words
come from `src/i18n/{locale}/hub.json`; the actions listed are the ones that
exist; and since the hub-locale change, 132 of the 214 hubs take their chrome
from a locale in the same script rather than English.

Two criteria are left. The first is a person rather than a commit: **a
speaker or translator reading the EN, `sw`, `es`, `hi` and `ar` strings and
saying whether that is how someone would actually put it.** Those strings were
written the same way the rest of this localization was — carefully, but
without a native reader — and they are what a person sees *before* they read
a word of the translation itself. The story text is the work of the
translation teams and needs no review here; the wrapper around it does.

The second is the one #17 states as "each language hub has at least a 2–3
sentence definition in the content language", and it is **not met** — not by
the hub FAQ, and not by the regional chrome fallback. Being exact about it:

- 17 catalog codes ARE one of the 16 marketing locales, so their hubs carry
  the definition in their own language.
- The other ~197 carry it in a regional language of the same script (Hindi on
  `/l/bho/`, Persian on `/l/azb/`) or in English (`/l/ha/`, and every
  Latin-script language). Hindi is not Bhojpuri. Regional chrome is a real
  improvement over English for those readers, and it is not the same claim.
- What every hub does carry in its own language is the H1 autonym, the
  story-1 extract, the story titles, and the story pages themselves. That is
  real in-language content; it is not a definition of what Open Bible Stories
  is.

Closing it means either translated `faqStories`/`faq` strings per content
language — 197 languages, so a translation-team task, not a code task — or
amending the criterion to "in the hub's chrome language, with the extract in
the content language". Either way it is a decision for #17, and until it is
made, these hubs should not be counted as localized-FAQ coverage.

## Getting a sheet

```
npm run review -- --priority                  # sw, es, hi, ar
npm run review -- sw --out=sw-review.md        # one locale, to a file
npm run review -- fa ur bn                     # any locales
```

It emits one markdown table per file (`hub.json`, `story.json`, `faq.json`,
`ui.json`): the key, the English source, the current translation, and a blank
column. Reviewers write in the blank column and leave it empty where the
current wording is fine.

Three flags matter:

- `[placeholder]` — the string carries `{language}`, `{n}`, `{count}` or
  `{total}`. Those markers are filled in at build time and must survive, in a
  position that reads naturally in the language: `{language} ဘာသာဖြင့်` and
  `en {language}` are not interchangeable word orders.
- `[link]` — the string carries an `<a href="…">`. The href must stay
  byte-identical (`npm run check:locales` fails otherwise); the link *text*
  should be translated.
- `[same as EN]` — identical to English, so probably missed rather than
  deliberate. A few are correct as-is (`PDF`, `CC BY-SA 4.0`, and the product
  name **Open Bible Stories**, which stays untranslated everywhere by
  convention).

## What to ask a reviewer to look at

Send the sheet *and* two or three live URLs, because wording that reads fine
in a table can read oddly in place:

| Locale | Hub to open | Why this one |
| --- | --- | --- |
| `sw` | `/l/sw/` and `/l/sw/story-1/` | the locale is also a content language |
| `es` | `/l/es-419/` | chrome resolved through a variant code |
| `hi` | `/l/hi/`, and `/l/bho/` | Bhojpuri gets Hindi chrome around Bhojpuri text — the case worth a second opinion |
| `ar` | `/l/ar/` and `/l/apd/` | RTL, and Sudanese Arabic with MSA chrome |
| `en` | `/faq/` | the eight answers other locales are translated from |

Specific questions worth asking, rather than "does this read well":

1. Does the FAQ answer sound like a person answering, or like a form?
2. Is "story" the word your churches use for these fifty pieces, or is there
   a better one? (`my` had two different words in two files before this
   review; there may be more.)
3. Does the license answer make it clear that printing and adapting are
   allowed, without sounding like a legal notice?
4. On `/l/bho/` (or `/l/apd/`): is chrome in the regional language better
   than chrome in English here, or worse? This is a judgement call the code
   cannot make, and reverting one language is a two-line change.
5. Are there names for this language, or older spellings of it, that the page
   does not list? They come from translationDatabase `langnames.json`, so a
   correction belongs upstream — but note it here first.

## While you have a reviewer

Two things in the same conversation, both cheap and both blocked on the same
person:

- The `in-language` rows of the search baseline
  ([`search-visibility.md`](search-visibility.md)): the sheet leaves **six
  blank rows** per language, each labelled with its intent — "Bible stories",
  "Bible stories PDF or printable", "listen to Bible stories", "Bible stories
  for children", how they would ask an assistant for them, and the name
  people actually use for the language. Six, not two: the generator writes
  19–23 rows on its own and these are what bring the sheet to the ~30 #19
  asks for. Nothing else in the measurement plan needs a translator, and
  machine-translating these phrases would produce a confident, wrong zero.
- Whether the autonym on the hub is right. It comes from the DCS manifest or
  `langnames.json`, and for a handful of languages it is the English name
  under a different spelling.

## Applying the results

Edit `src/i18n/{locale}/{file}.json`, then:

```
npm run check:locales   # structure, arrays, embedded hrefs, protected terms
npm run build && npm run check:routes
```

`check:locales` also prints an untranslated ratio per locale, which is the
quickest way to see whether a review pass actually landed.

## Not covered by a review sheet

- **38 languages had no font pack** and rendered in whatever face the
  visitor's OS had. Fixed in code (Odia, Gujarati, Gurmukhi, Tamil, Telugu,
  Kannada, Malayalam, Lao and Ethiopic packs), and `npm run check:scripts`
  now fails when a newly published language uses a script we do not ship.
- **The reader's own chrome** (`public/assets/js/reader.js`) and the
  Resources browser (`resources.js`) are still English-only strings in
  JavaScript, outside the i18n files. That is a separate piece of work and
  worth its own issue.

## One thing a reviewer should know about the hubs

A hub is built in one interface language and swapped in the browser for a
visitor who prefers another (`public/assets/js/locale.js`, and the
`/assets/i18n/{locale}.json` bundles). So a reviewer opening `/l/bho/` sees
the chrome in **their own** preferred language, not necessarily the Hindi the
page was built with — and if they want to see the built version, they should
clear `obs.locale` from the site's local storage, or open the hub in a browser
set to Hindi. `npm run check:locale-swap` drives that behaviour in a real
browser after a build.

Two consequences for a review:

- Placeholders matter more than they look. A swapped string is re-filled with
  the same arguments in the reviewer's locale, so `{language}` and `{n}` have
  to sit where the sentence needs them in **every** locale, not just read
  well in one.
- The hub FAQ's first answer embeds one of the three `faqStories` sentences by
  reference, so those three have to work as a clause inside that answer, in
  each locale, and not only as standalone sentences.
