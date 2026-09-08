// Canonical English slugs for the 50 stories, from the unfoldingWord/en_obs
// v9 titles. Deliberately identical in every language so story URLs stay
// stable and ASCII: slugifying local titles would percent-encode badly for
// non-Latin scripts and would move a URL whenever a translation is revised.
//
// This must stay in step with STORY_SLUGS in scripts/fetch-catalog.mjs, which
// writes the same slug into each story record; scripts/check-routes.mjs fails
// the build if the two ever diverge.
export const STORY_SLUGS: string[] = [
  'the-creation', 'sin-enters-the-world', 'the-flood', 'gods-covenant-with-abraham', 'the-son-of-promise',
  'god-provides-for-isaac', 'god-blesses-jacob', 'god-saves-joseph-and-his-family', 'god-calls-moses', 'the-ten-plagues',
  'the-passover', 'the-exodus', 'gods-covenant-with-israel', 'wandering-in-the-wilderness', 'the-promised-land',
  'the-deliverers', 'gods-covenant-with-david', 'the-divided-kingdom', 'the-prophets', 'the-exile-and-return',
  'god-promises-the-messiah', 'the-birth-of-john', 'the-birth-of-jesus', 'john-baptizes-jesus', 'satan-tempts-jesus',
  'jesus-starts-his-ministry', 'the-story-of-the-good-samaritan', 'the-rich-young-ruler', 'the-story-of-the-unmerciful-servant', 'jesus-feeds-thousands-of-people',
  'jesus-walks-on-water', 'jesus-heals-a-demon-possessed-man-and-a-sick-woman', 'the-story-of-the-farmer', 'jesus-teaches-other-stories', 'the-story-of-the-compassionate-father',
  'the-transfiguration', 'jesus-raises-lazarus-from-the-dead', 'jesus-is-betrayed', 'jesus-is-put-on-trial', 'jesus-is-crucified',
  'god-raises-jesus-from-the-dead', 'jesus-returns-to-heaven', 'the-church-begins', 'peter-and-john-heal-a-beggar', 'stephen-and-philip',
  'saul-becomes-a-follower-of-jesus', 'paul-and-silas-in-philippi', 'jesus-is-the-promised-messiah', 'gods-new-covenant', 'jesus-returns',
];

/** URL slug for a story number, e.g. 1 -> "the-creation". */
export function storySlug(num: number): string {
  return STORY_SLUGS[num - 1] ?? String(num);
}
