import type { APIRoute } from 'astro';
import { pagesSitemap, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = () => xmlResponse(pagesSitemap());
