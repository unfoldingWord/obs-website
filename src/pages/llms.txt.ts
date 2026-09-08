import type { APIRoute } from 'astro';
import { llmsTxt, textResponse } from '../lib/markdown';

// Lists only URLs that exist in this build — see src/lib/markdown.ts, and
// `npm run check:routes`, which re-reads the served file and fails on any
// URL with no file behind it.
export const GET: APIRoute = async () => textResponse(await llmsTxt());
