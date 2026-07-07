// thai-open-data-mcp — MCP server for Thailand's open government data.
// Serves from a D1 MIRROR of data.go.th's catalog (data.go.th's WAF blocks all
// datacenter IPs — measured 403 from Cloudflare, AWS US and AWS Singapore on
// 2026-07-07 — so runtime pass-through is impossible from cloud hosts; the
// mirror is synced from a Thai IP via scripts/sync-catalog.mjs).
//
// PDPA by design: the mirror is a field WHITELIST — CKAN maintainer/author/
// contact fields (personal data) never enter storage; datasets without a
// stated license are stored link-only. Dataset downloads resolve to
// data.go.th's own servers; this server hosts metadata, not data.
//
// When invoked WITHOUT a db (self-hosting on an unblocked/Thai IP), tools
// fall back to live CKAN calls.

const CKAN = 'https://data.go.th/api/3/action';
const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'thai-open-data', version: '0.2.0' };

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

const TOOLS = [
  {
    name: 'search_datasets',
    description:
      'Search Thailand\'s national open-data catalog (data.go.th, Digital Government Development Agency) — 41,000+ official government datasets: tourism, health, transport, economy, environment, education and more. Thai or English queries. Returns dataset title, publishing agency, tags, file formats, and a canonical URL to cite.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, e.g. "tourism statistics", "สถิตินักท่องเที่ยว", "air quality"' },
        limit: { type: 'number', description: 'Max results, 1-20 (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_dataset',
    description:
      'Get the full record for one dataset on data.go.th by its id (from search_datasets): description, publishing organization, license, tags, and downloadable resources (CSV/XLSX/JSON/API links).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Dataset id from search results' } },
      required: ['id'],
    },
  },
  {
    name: 'list_groups',
    description: 'List the thematic groups/categories of Thailand\'s open-data catalog with dataset counts.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------- shared shaping ----------

const trunc = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const parseJ = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return []; } };

// ---------- live CKAN path (fallback for unblocked self-hosts) ----------

async function ckan(action: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${CKAN}/${action}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`data.go.th ${action} responded ${r.status}`);
  const d: any = await r.json();
  if (!d.success) throw new Error(`data.go.th ${action} returned success=false`);
  return d.result;
}

function liveCard(p: any) {
  return {
    id: p.name,
    title: p.title,
    summary: trunc(p.notes, 280),
    organization: p.organization?.title ?? null,
    tags: (p.tags ?? []).slice(0, 8).map((t: any) => t.name),
    formats: [...new Set((p.resources ?? []).map((r: any) => String(r.format || '').toUpperCase()).filter(Boolean))],
    license: p.license_title ?? p.license_id ?? 'not specified',
    url: `https://data.go.th/dataset/${p.name}`,
  };
}

// ---------- D1 mirror path (primary hosted mode) ----------

const STOP = new Set(['the', 'of', 'in', 'for', 'and', 'or', 'to', 'a', 'an', 'data', 'dataset', 'ข้อมูล']);

async function mirrorSearch(db: any, query: string, limit: number) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9฀-๿]+/i)
    .filter((t) => t.length > 1 && !STOP.has(t));
  if (!tokens.length) return { total_matching: 0, results: [] };

  // instr() instead of LIKE: D1's SQLite rejects case-insensitive LIKE on longer
  // Thai patterns ("pattern too complex"); instr is a plain substring check with
  // no pattern engine — same semantics here since we lower() both sides.
  const score = tokens
    .map(() =>
      '(CASE WHEN instr(lower(title), ?) > 0 THEN 5 ELSE 0 END + CASE WHEN instr(lower(tags), ?) > 0 THEN 4 ELSE 0 END' +
      ' + CASE WHEN instr(lower(org), ?) > 0 THEN 3 ELSE 0 END + CASE WHEN instr(lower(summary), ?) > 0 THEN 2 ELSE 0 END)'
    )
    .join(' + ');
  const binds: string[] = [];
  for (const t of tokens) binds.push(t, t, t, t);

  const { results } = await db
    .prepare(`SELECT * FROM (SELECT id,title,summary,org,tags,formats,license,updated,url,(${score}) AS s FROM datasets) WHERE s > 0 ORDER BY s DESC, updated DESC LIMIT ?`)
    .bind(...binds, Math.min(Math.max(limit || 5, 1), 20))
    .all();
  return {
    total_matching: results.length,
    results: results.map((r: any) => ({
      id: r.id, title: r.title, summary: r.summary || undefined, organization: r.org || null,
      tags: parseJ(r.tags), formats: parseJ(r.formats), license: r.license, last_updated: r.updated || null, url: r.url,
    })),
  };
}

async function mirrorGet(db: any, id: string) {
  const r = await db.prepare('SELECT * FROM datasets WHERE id = ?').bind(String(id)).first();
  if (!r) return null;
  return {
    id: r.id, title: r.title, summary: r.summary || undefined, organization: r.org || null,
    tags: parseJ(r.tags), formats: parseJ(r.formats), resources: r.resources,
    resources_list: parseJ(r.resources_list), license: r.license, last_updated: r.updated || null, url: r.url,
  };
}

async function syncedAt(db: any): Promise<string | null> {
  try { return (await db.prepare("SELECT v FROM meta WHERE k='synced_at'").first())?.v ?? null; } catch { return null; }
}

// ---------- MCP plumbing ----------

type Rpc = { jsonrpc: '2.0'; id?: unknown; method?: string; params?: any };
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
export const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (id: unknown, data: unknown, isError = false) =>
  ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : {}) });

async function handle(msg: Rpc, db: any): Promise<object | null> {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize': {
        const stamp = db ? await syncedAt(db) : null;
        return ok(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            `Thai Open Data — search and read Thailand's official open-government dataset catalog (data.go.th, Digital Government Development Agency; 41,000+ datasets${stamp ? `, mirror synced ${stamp.slice(0, 10)}` : ''}). Thai or English queries. Use search_datasets → get_dataset; cite the returned url. Downloads resolve to data.go.th directly.`,
        });
      }
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name === 'search_datasets') {
          if (db) return textResult(id, await mirrorSearch(db, args.query, Number(args.limit)));
          const res = await ckan('package_search', { q: String(args.query ?? ''), rows: String(Math.min(Math.max(Number(args.limit) || 5, 1), 20)) });
          return textResult(id, { total_matching: res.count, results: (res.results ?? []).map(liveCard) });
        }
        if (name === 'get_dataset') {
          if (db) {
            const rec = await mirrorGet(db, args.id);
            return rec ? textResult(id, rec) : textResult(id, `No dataset found for id "${args.id}".`, true);
          }
          return textResult(id, liveCard(await ckan('package_show', { id: String(args.id ?? '') })));
        }
        if (name === 'list_groups') {
          if (db) {
            const { results } = await db.prepare('SELECT * FROM groups ORDER BY datasets DESC').all();
            return textResult(id, results);
          }
          const res = await ckan('group_list', { all_fields: 'true' });
          return textResult(id, (res ?? []).map((g: any) => ({ id: g.name, title: g.display_name ?? g.title, datasets: g.package_count ?? null })));
        }
        return err(id, -32602, `Unknown tool: ${name}`);
      }
      case 'ping':
        return ok(id, {});
      default:
        if (id === undefined || id === null) return null;
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e: any) {
    return textResult(id, `Upstream error: ${e?.message ?? e}`, true);
  }
}

export async function handleBody(body: Rpc | Rpc[], db: any = null): Promise<{ status: number; payload: object | object[] | null }> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, db)))).filter(Boolean) as object[];
    return out.length ? { status: 200, payload: out } : { status: 202, payload: null };
  }
  const res = await handle(body, db);
  return res ? { status: 200, payload: res } : { status: 202, payload: null };
}

export const DISCOVERY = {
  name: 'Thai Open Data MCP',
  description:
    "MCP server for Thailand's official open-government data catalog (data.go.th, 41,000+ datasets). Free, no API key. Made by Greenstead Co Ltd.",
  transport: 'streamable-http',
  endpoint: '/',
  protocolVersion: PROTOCOL,
  tools: TOOLS.map((t) => t.name),
  source: 'https://github.com/sarapab-th/thai-open-data-mcp',
};
