import { defaultLocale } from './config';

const modules = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', {
  eager: true,
});

function get(locale: string, page: string): Record<string, unknown> | undefined {
  return modules[`./${locale}/${page}.json`]?.default;
}

/** Deep-merge English fallback under the locale's content so a missing key
 *  degrades to English instead of a blank spot. */
function merge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null || over === '') return base;
  if (Array.isArray(base) && Array.isArray(over)) {
    return base.map((item, i) => merge(item, over[i])) as T;
  }
  if (typeof base === 'object' && base !== null && typeof over === 'object') {
    const out: Record<string, unknown> = { ...(over as Record<string, unknown>) };
    for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
      out[k] = merge(v, (over as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return over as T;
}

export function content<T = Record<string, any>>(locale: string, page: string): T {
  const base = get(defaultLocale, page);
  if (!base) throw new Error(`No English content for page "${page}"`);
  if (locale === defaultLocale) return base as T;
  return merge(base, get(locale, page)) as T;
}
