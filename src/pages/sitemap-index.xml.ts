import type { APIRoute } from 'astro';
import { sitemapIndex, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = () => xmlResponse(sitemapIndex(['sitemap-pages.xml', 'sitemap-languages.xml', 'sitemap-stories.xml']));
