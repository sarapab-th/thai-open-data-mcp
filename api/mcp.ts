// PAUSED 2026-07-09 by Greenstead Co Ltd, pending direct outreach to DGA
// (Digital Government Development Agency) before this stays live long-term.
// This is a deliberate, reversible pause — not a shutdown. Original live code
// backed up; D1 mirror and GitHub repo are untouched. Restore by reverting
// this file once resolved.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return res.status(503).json({
    name: 'Thai Open Data MCP',
    status: 'paused',
    message:
      "This server is temporarily paused while we reach out to Thailand's Digital Government Development Agency (DGA) directly, out of respect, before continuing to serve a mirror of their catalog. It will return once that conversation has happened. Source is public and unchanged: https://github.com/sarapab-th/thai-open-data-mcp",
    contact: 'goyasapiens@gmail.com',
  });
}
