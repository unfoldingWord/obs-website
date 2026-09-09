// Full story text, one file per language.
//
// scripts/fetch-catalog.mjs writes src/data/stories/{code}.json. Unlike the
// catalog snapshot those files are generated and gitignored: together they
// are tens of megabytes, far too much to commit, and the build already
// downloads every story file to read its title. They are loaded lazily —
// import.meta.glob without `eager` returns a loader per file, so a story
// page pulls in only its own language.
//
// Which stories get a page is `storyNums` on the catalog record intersected
// with what this file holds: the metadata says which stories the language has,
// and this says which of them the build has the text for. Hub links, the
// sitemap and prev/next are all built from that same intersection, so a
// partial fetch cannot leave a link pointing at a page that was skipped.

/** One illustration and the text that follows it. `image` is null for a
 *  paragraph that has no illustration of its own. */
export interface StoryFrame {
  image: string | null;
  text: string;
}

export interface Story {
  num: number;
  title: string;
  /** "A Bible story from: Genesis 1-2", in the language, when present. */
  reference: string | null;
  frames: StoryFrame[];
  /** Per-story mp3 from the newest release that has one, else null. */
  audio: string | null;
  /** Per-story video file (smallest rendition published), else null. Absent
   *  in story files written before #16 — read it as optional. */
  video?: string | null;
  /**
   * Publish date of the release the video came from (ISO date), or null.
   *
   * Not the language's newest release: a video is published once and the text
   * revised several times afterwards, so taking the language's `updated`
   * silently rewrote the apparent upload date of an unchanged video on every
   * text release. `uploadDate` is required for a VideoObject, so the node is
   * omitted when this is missing rather than guessed.
   */
  videoDate?: string | null;
}

interface StoryFile {
  code: string;
  stories: Story[];
}

const files = import.meta.glob<{ default: StoryFile }>('./stories/*.json');

/**
 * Whether this language's story text is present in THIS build.
 *
 * `storyNums` in the committed catalog snapshot records what a previous fetch
 * found, but the story files themselves are gitignored. If a build falls back
 * to the snapshot (a Door43 outage, a fresh clone with no fetch) those files
 * are absent, and trusting `storyNums` alone would emit sitemap entries and
 * hub links for pages that were never built. Everything that claims a story
 * page exists checks here first.
 */
export function hasStories(code: string): boolean {
  return `./stories/${code}.json` in files;
}

/** Every story with full text for one language, in file order. Empty when
 *  the language has no story file (never throws — a missing file just means
 *  no story pages, which `storyNums` already reflects). */
export async function storiesFor(code: string): Promise<Story[]> {
  const load = files[`./stories/${code}.json`];
  if (!load) return [];
  try {
    return (await load()).default.stories ?? [];
  } catch {
    return [];
  }
}
