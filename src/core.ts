// thai-open-data-mcp — MCP server for Thailand's open government data.
// Wraps the public CKAN catalog API of data.go.th (Digital Government
// Development Agency) so AI assistants can search and read Thailand's official
// open datasets directly. Streamable-HTTP transport (stateless JSON-RPC 2.0).
//
// Catalog endpoints are public — no API key required. Row-level datastore
// access (opend.data.go.th) and TAT tourism / TMD weather sources need keys
// and land in a later phase (see README roadmap).

const CKAN = 'https://data.go.th/api/3/action';
const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'thai-open-data', version: '0.1.0' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

const TOOLS = [
  {
    name: 'search_datasets',
    description:
      'Search Thailand\'s national open-data catalog (data.go.th, run by the Digital Government Development Agency) for official government datasets — tourism, health, transport, economy, environment, education and more. Works with Thai or English queries. Returns dataset title, publishing agency, tags, available file formats, and a canonical URL to cite.',
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
      'Get the full record for one dataset on data.go.th by its id/name (from search_datasets results): description, publishing organization, update frequency, tags, and every downloadable resource (CSV/XLSX/JSON/API links).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Dataset name/id from search results' } },
      required: ['id'],
    },
  },
  {
    name: 'list_groups',
    description: 'List the thematic groups/categories of Thailand\'s open-data catalog (data.go.th) with dataset counts — useful to discover what kinds of official data exist.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// --- CKAN helpers: trim the huge CKAN records down to LLM-friendly cards ---

async function ckan(action: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${CKAN}/${action}${qs ? `?${qs}` : ''}`, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
  });
  if (!r.ok) throw new Error(`data.go.th ${action} responded ${r.status}`);
  const d: any = await r.json();
  if (!d.success) throw new Error(`data.go.th ${action} returned success=false`);
  return d.result;
}

const trunc = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

function datasetCard(p: any) {
  return {
    id: p.name,
    title: p.title,
    summary: trunc(p.notes, 280),
    organization: p.organization?.title ?? null,
    tags: (p.tags ?? []).slice(0, 8).map((t: any) => t.name),
    formats: [...new Set((p.resources ?? []).map((r: any) => String(r.format || '').toUpperCase()).filter(Boolean))],
    resources: (p.resources ?? []).length,
    last_updated: p.metadata_modified ?? null,
    url: `https://data.go.th/dataset/${p.name}`,
  };
}

function datasetFull(p: any) {
  return {
    ...datasetCard(p),
    summary: trunc(p.notes, 1200),
    update_frequency: p.frequency ?? p.update_frequency ?? null,
    license: p.license_title ?? p.license_id ?? null,
    resources_list: (p.resources ?? []).slice(0, 25).map((r: any) => ({
      name: trunc(r.name, 120),
      format: String(r.format || '').toUpperCase() || null,
      url: r.url,
    })),
  };
}

// --- MCP plumbing (stateless streamable HTTP, JSON-RPC 2.0) ---

type Rpc = { jsonrpc: '2.0'; id?: unknown; method?: string; params?: any };
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (id: unknown, data: unknown, isError = false) =>
  ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : {}) });

async function handle(msg: Rpc): Promise<object | null> {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'Thai Open Data — search and read Thailand\'s official open-government datasets (data.go.th, Digital Government Development Agency). Use search_datasets to find official data (Thai or English queries), get_dataset for full details and download links, list_groups to browse categories. Cite the returned url.',
        });
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name === 'search_datasets') {
          const rows = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
          const res = await ckan('package_search', { q: String(args.query ?? ''), rows: String(rows) });
          return textResult(id, {
            total_matching: res.count,
            results: (res.results ?? []).map(datasetCard),
          });
        }
        if (name === 'get_dataset') {
          const res = await ckan('package_show', { id: String(args.id ?? '') });
          return textResult(id, datasetFull(res));
        }
        if (name === 'list_groups') {
          const res = await ckan('group_list', { all_fields: 'true' });
          return textResult(id, (res ?? []).map((g: any) => ({ id: g.name, title: g.display_name ?? g.title, datasets: g.package_count ?? null })));
        }
        return err(id, -32602, `Unknown tool: ${name}`);
      }
      case 'ping':
        return ok(id, {});
      default:
        if (id === undefined || id === null) return null; // notification
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e: any) {
    return textResult(id, `Upstream error: ${e?.message ?? e}`, true);
  }
}


// Shared request handler: takes a parsed JSON-RPC body, returns {status, body|null}.
export async function handleBody(body: Rpc | Rpc[]): Promise<{ status: number; payload: object | object[] | null }> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean) as object[];
    return out.length ? { status: 200, payload: out } : { status: 202, payload: null };
  }
  const res = await handle(body);
  return res ? { status: 200, payload: res } : { status: 202, payload: null };
}

export const DISCOVERY = {
  name: 'Thai Open Data MCP',
  description: "MCP server for Thailand's official open-government data (data.go.th). Free, no API key. Made by Greenstead Co Ltd.",
  transport: 'streamable-http',
  endpoint: '/',
  protocolVersion: PROTOCOL,
  tools: TOOLS.map((t) => t.name),
  source: 'https://github.com/sarapab-th/thai-open-data-mcp',
};

export { CORS, err };
