// Cloudflare Worker entry — kept for self-hosters. NOTE: data.go.th's WAF
// currently 403s Cloudflare egress IPs, so the primary hosted endpoint runs on
// Vercel (api/mcp.ts). This entry works from hosts data.go.th doesn't block.
import { handleBody, DISCOVERY, CORS, err } from './core';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET')
      return new Response(JSON.stringify(DISCOVERY), { status: 200, headers: { 'content-type': 'application/json', ...CORS } });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify(err(null, -32700, 'Parse error')), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }

    const { status, payload } = await handleBody(body);
    if (!payload) return new Response(null, { status, headers: CORS });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...CORS } });
  },
};
