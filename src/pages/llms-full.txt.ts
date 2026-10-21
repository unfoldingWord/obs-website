import type { APIRoute } from 'astro';
import { llmsFullTxt, textResponse } from '../lib/markdown';

// The index plus the full English text — see llmsFullTxt in src/lib/markdown.ts.
export const GET: APIRoute = async () => textResponse(await llmsFullTxt());
