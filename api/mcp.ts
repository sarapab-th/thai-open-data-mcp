// Vercel Node serverless entry (AWS egress — data.go.th's WAF blocks
// Cloudflare's IP ranges, so the hosted endpoint lives here; src/index.ts
// keeps the Cloudflare Worker for self-hosters whose egress isn't blocked).
import { handleBody, DISCOVERY, CORS, err } from '../src/core';

export default async function handler(req: any, res: any) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v as string);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    // temp diagnostic: /?probe=1 fetches candidate upstream hosts, reports status
    if (req.query?.probe) {
      const targets = [
        'https://data.go.th/api/3/action/package_search?q=test&rows=1',
        'https://gdcatalog.go.th/api/3/action/package_search?q=test&rows=1',
        'https://opend.data.go.th/get-ckan/datastore_search?limit=1',
      ];
      const out: Record<string, string> = {};
      for (const t of targets) {
        try {
          const r = await fetch(t, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
          out[t] = String(r.status);
        } catch (e: any) { out[t] = `ERR ${e?.message ?? e}`; }
      }
      return res.status(200).json(out);
    }
    return res.status(200).json(DISCOVERY);
  }
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json(err(null, -32700, 'Parse error'));
    }
  }
  if (!body || typeof body !== 'object') return res.status(400).json(err(null, -32700, 'Parse error'));

  const { status, payload } = await handleBody(body);
  if (!payload) return res.status(status).end();
  return res.status(status).json(payload);
}
