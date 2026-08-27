export interface LocaleDef {
  code: string;
  /** Language name in its own language — shown in the switcher. */
  name: string;
  /** BCP-47 tag emitted in <html lang> and hreflang. */
  tag: string;
  dir: 'ltr' | 'rtl';
  /**
   * Which self-hosted font pack the locale needs beyond the site's
   * Montserrat / Nunito Sans faces (latin + latin-ext woff2 in
   * public/assets/fonts/). Latin locales load none; every other value names
   * a stylesheet generated into public/assets/fonts/ by
   * scripts/build-font-css.mjs and <link>ed by Base.astro — see
   * fontHrefFor(). Fonts are self-hosted for the same reason as the Latin
   * faces: no third-party font host, which is slow or blocked in parts of
   * the world these locales serve. Must stay in sync with the :lang()
   * rules in public/assets/css/styles.css.
   */
  script: 'latin' | 'cyrillic' | 'arabic' | 'nastaliq' | 'devanagari' | 'bengali' | 'myanmar' | 'han';
}

/** Stylesheet path for the locale's script, or null when the default
 *  self-hosted Latin faces suffice. */
export function fontHrefFor(code: string): string | null {
  const { script } = byCode(code);
  return script === 'latin' ? null : `/assets/fonts/${script}.css`;
}

export const locales: LocaleDef[] = [
  { code: 'en', name: 'English',           tag: 'en',      dir: 'ltr', script: 'latin' },
  { code: 'es', name: 'Español',           tag: 'es-MX',   dir: 'ltr', script: 'latin' },
  { code: 'fr', name: 'Français',          tag: 'fr',      dir: 'ltr', script: 'latin' },
  { code: 'hi', name: 'हिन्दी',              tag: 'hi',      dir: 'ltr', script: 'devanagari' },
  { code: 'ru', name: 'Русский',           tag: 'ru',      dir: 'ltr', script: 'cyrillic' },
  { code: 'ar', name: 'العربية',            tag: 'ar',      dir: 'rtl', script: 'arabic' },
  { code: 'zh', name: '简体中文',           tag: 'zh-Hans', dir: 'ltr', script: 'han' },
  { code: 'sw', name: 'Kiswahili',         tag: 'sw',      dir: 'ltr', script: 'latin' },
  { code: 'pt', name: 'Português',         tag: 'pt-BR',   dir: 'ltr', script: 'latin' },
  { code: 'id', name: 'Bahasa Indonesia',  tag: 'id',      dir: 'ltr', script: 'latin' },
  { code: 'vi', name: 'Tiếng Việt',        tag: 'vi',      dir: 'ltr', script: 'latin' },
  { code: 'bn', name: 'বাংলা',              tag: 'bn',      dir: 'ltr', script: 'bengali' },
  { code: 'ur', name: 'اردو',               tag: 'ur',      dir: 'rtl', script: 'nastaliq' },
  { code: 'fa', name: 'فارسی',              tag: 'fa',      dir: 'rtl', script: 'arabic' },
  { code: 'my', name: 'ဗမာစာ',             tag: 'my',      dir: 'ltr', script: 'myanmar' },
  { code: 'nl', name: 'Nederlands',        tag: 'nl',      dir: 'ltr', script: 'latin' },
];

export const defaultLocale = 'en';

/** Pages that exist in every locale. */
export const localizedSlugs = [
  'home', 'why-obs', 'discover', 'discover-read',
  'translate', 'create', 'contact',
] as const;
/** Legal pages and the 404 stay English-only at the site root. */
export const englishOnlySlugs = ['license', 'privacy', 'terms-of-use', '404'] as const;
export const pageSlugs = [...localizedSlugs, ...englishOnlySlugs];
export type PageSlug = (typeof pageSlugs)[number];

export function isLocalized(slug: PageSlug): boolean {
  return (localizedSlugs as readonly string[]).includes(slug);
}

/** URL path fragment for each page, relative to the locale root. */
const slugPaths: Record<PageSlug, string> = {
  home: '',
  'why-obs': 'why-obs/',
  discover: 'discover/',
  'discover-read': 'discover/read/',
  translate: 'translate/',
  create: 'create/',
  contact: 'contact/',
  license: 'license/',
  privacy: 'privacy/',
  'terms-of-use': 'terms-of-use/',
  '404': '404/',
};

export function byCode(code: string): LocaleDef {
  const found = locales.find((l) => l.code === code);
  if (!found) throw new Error(`Unknown locale: ${code}`);
  return found;
}

/** Path for a page in a locale — English stays at the site root, and
 *  English-only pages (legal, 404) always resolve to the root path. */
export function localePath(locale: string, slug: PageSlug): string {
  const page = slugPaths[slug];
  return locale === defaultLocale || !isLocalized(slug) ? `/${page}` : `/${locale}/${page}`;
}

/** Rewrite root-relative internal links inside an HTML string so in-copy
 *  links (e.g. href="/discover/") stay within the current locale.
 *  English-only pages (e.g. /license/) are left at the root. */
export function localizeLinks(html: string, locale: string): string {
  if (locale === defaultLocale) return html;
  const internal = new Set(localizedSlugs.map((s) => `/${slugPaths[s]}`));
  return html.replace(/href="(\/[^"]*)"/g, (m, path) =>
    internal.has(path) ? `href="/${locale}${path}"` : m
  );
}
