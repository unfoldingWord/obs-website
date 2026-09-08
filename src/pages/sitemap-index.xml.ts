import type { APIRoute } from 'astro';
import { sitemapFiles, sitemapIndex, xmlResponse } from '../lib/sitemap';

// sitemap-stories.xml is listed only when story pages were built in this
// run — see sitemapFiles(); an empty <urlset> is not a valid sitemap.
export const GET: APIRoute = async () => xmlResponse(sitemapIndex(await sitemapFiles()));
