import type { APIRoute } from 'astro';
import { storiesSitemap, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async () => xmlResponse(await storiesSitemap());
