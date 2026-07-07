# Thai Open Data MCP 🇹🇭

**Make Thailand's public data speak AI.** An MCP (Model Context Protocol) server that lets AI assistants — Claude, ChatGPT, OpenWebUI, Cursor, any MCP client — search and read Thailand's official open-government data directly from [data.go.th](https://data.go.th/), the national open-data catalog run by the Digital Government Development Agency (DGA).

Free. No API key. Remote — nothing to install.

## Try it

Hosted streamable-HTTP endpoint:

```
https://thai-open-data-mcp.<worker-subdomain>.workers.dev/
```

Claude Desktop / any MCP client config:

```json
{ "mcpServers": { "thai-open-data": { "url": "https://thai-open-data-mcp.<worker-subdomain>.workers.dev/" } } }
```

OpenWebUI: add a connection of type **MCP** with the URL above, auth **None**. (Intended for shared/assistant use, not standalone agents.)

## Tools

| Tool | What it does |
|---|---|
| `search_datasets` | Search the national catalog — Thai or English queries ("tourism statistics", "สถิตินักท่องเที่ยว", "air quality") |
| `get_dataset` | Full record for one dataset: description, agency, tags, every downloadable resource (CSV/XLSX/JSON/API) |
| `list_groups` | Browse the catalog's thematic categories with dataset counts |

Every result carries a canonical `data.go.th` URL to cite.

## Why

Tourists, researchers and citizens now ask AI assistants questions Thailand's government already publishes answers to — but assistants can't read the portals built for human developers. This server closes that gap: official data, AI-readable, one endpoint.

Inspired by Spain's community-built [datos-gob-es-mcp](https://github.com/AlbertoUAH/datos-gob-es-mcp). Built on the production patterns of [Booyah Index MCP](https://getbooyah.com/api/mcp) (3,500+ SEA businesses served over MCP).

## Roadmap

- **TAT tourism data** — attractions, events, routes via the [TAT Developer Portal](https://developers.tourismthailand.org/) (needs API key)
- **TMD weather** — Thai Meteorological Department forecasts (needs API key)
- **Row-level datastore queries** — opend.data.go.th (needs API key)
- **NSO statistics** — National Statistical Office

## Self-host

```bash
npm install
npm run deploy   # Cloudflare Workers, free tier is plenty
```

## License

MIT © 2026 [Greenstead Co Ltd](https://greenstead-th.com) — a Thai company. Data belongs to its publishing agencies; this project only makes it reachable.
