import type { APIRoute } from 'astro';
import { languagesSitemap, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = () => xmlResponse(languagesSitemap());
