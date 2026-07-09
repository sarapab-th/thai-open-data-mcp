// PAUSED 2026-07-09 by Greenstead Co Ltd, pending direct outreach to DGA
// (Digital Government Development Agency) before this stays live long-term.
// This is a deliberate, reversible pause — not a shutdown. Original live code
// backed up; D1 mirror and GitHub repo are untouched. Restore by reverting
// this file once resolved.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    return new Response(
      JSON.stringify({
        name: 'Thai Open Data MCP',
        status: 'paused',
        message:
          "This server is temporarily paused while we reach out to Thailand's Digital Government Development Agency (DGA) directly, out of respect, before continuing to serve a mirror of their catalog. It will return once that conversation has happened. Source is public and unchanged: https://github.com/sarapab-th/thai-open-data-mcp",
        contact: 'goyasapiens@gmail.com',
      }, null, 2),
      { status: 503, headers: { 'content-type': 'application/json', ...CORS } }
    );
  },
};
