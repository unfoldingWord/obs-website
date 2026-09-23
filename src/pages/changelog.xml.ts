import type { APIRoute } from 'astro';
import { changelogFeed } from '../lib/changelog';

// Atom feed of the /changelog/ events — see src/lib/changelog.ts. Served as
// a static .xml file, so the content type is Cloudflare's application/xml;
// feed readers sniff Atom from the root element.
export const GET: APIRoute = () =>
  new Response(changelogFeed(), { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });
