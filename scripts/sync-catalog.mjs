// sync-catalog.mjs — mirror data.go.th's catalog metadata into the Worker's D1.
//
// MUST run from a Thai residential IP (data.go.th's WAF 403s all datacenter
// IPs — Cloudflare, AWS US, AWS SG all measured blocked 2026-07-07). This
// script is the bridge: local fetch → trimmed whitelist → D1 via wrangler.
//
// PDPA by design: field WHITELIST only. CKAN's maintainer/author/contact
// fields (personal data — named officials + emails) never enter the mirror.
// Datasets with no stated license are stored link-only (title + url + org,
// no summary/tags enrichment) per the license-variance rule.
//
// Usage: node scripts/sync-catalog.mjs          # full sync (~83 pages, few min)
//        node scripts/sync-catalog.mjs --pages 2  # smoke test
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '.seed');
const CKAN = 'https://data.go.th/api/3/action';
const ROWS = 100;
const pagesArg = process.argv.indexOf('--pages');
const MAX_PAGES = pagesArg > -1 ? parseInt(process.argv[pagesArg + 1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const trunc = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

async function ckan(action, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${CKAN}/${action}?${qs}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${action} ${r.status}`);
  const d = await r.json();
  if (!d.success) throw new Error(`${action} success=false`);
  return d.result;
}

// Whitelist one CKAN package → mirror row. No maintainer/author/contact fields, ever.
function row(p) {
  const license = p.license_title || p.license_id || null;
  const linkOnly = !license;
  const tags = linkOnly ? [] : (p.tags ?? []).slice(0, 8).map((t) => t.name);
  const resList = linkOnly
    ? []
    : (p.resources ?? []).slice(0, 25).map((r) => ({ name: trunc(r.name, 100), format: String(r.format || '').toUpperCase() || null, url: r.url }));
  return {
    id: p.name,
    title: trunc(p.title, 300),
    summary: linkOnly ? '' : trunc(p.notes, 600),
    org: p.organization?.title ?? '',
    tags: JSON.stringify(tags),
    formats: JSON.stringify([...new Set((p.resources ?? []).map((r) => String(r.format || '').toUpperCase()).filter(Boolean))]),
    resources: (p.resources ?? []).length,
    resources_list: JSON.stringify(resList),
    license: license ?? 'not specified',
    updated: p.metadata_modified ?? '',
    url: `https://data.go.th/dataset/${p.name}`,
  };
}

mkdirSync(OUT, { recursive: true });

console.log('▶ fetching catalog…');
async function ckanRetry(action, params, tries = 4) {
  for (let a = 1; ; a++) {
    try { return await ckan(action, params); }
    catch (e) { if (a >= tries) throw e; await sleep(1500 * a); }
  }
}
const first = await ckanRetry('package_search', { q: '', rows: String(ROWS), start: '0' });
const total = first.count;
const pages = Math.min(Math.ceil(total / ROWS), MAX_PAGES);
console.log(`  ${total} datasets, ${pages} pages of ${ROWS}`);

const all = [...first.results.map(row)];
for (let p = 1; p < pages; p++) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ckanRetry('package_search', { q: '', rows: String(ROWS), start: String(p * ROWS) });
      all.push(...res.results.map(row));
      break;
    } catch (e) {
      if (attempt >= 3) { console.warn(`  ! page ${p}: ${e.message} (skipped)`); break; }
      await sleep(1500 * attempt);
    }
  }
  if (p % 10 === 0) console.log(`  …page ${p}/${pages} (${all.length} rows)`);
  await sleep(250);
}
console.log(`  ✓ ${all.length} datasets fetched`);

console.log('▶ fetching groups…');
const groups = await ckan('group_list', { all_fields: 'true' });

// --- emit chunked SQL (wrangler d1 execute has a per-file size cap) ---
const stamp = new Date().toISOString();
const header = `
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, title TEXT, summary TEXT, org TEXT, tags TEXT,
  formats TEXT, resources INTEGER, resources_list TEXT, license TEXT,
  updated TEXT, url TEXT
);
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, title TEXT, datasets INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
DELETE FROM datasets; DELETE FROM groups; DELETE FROM meta;
INSERT INTO meta VALUES ('synced_at', '${stamp}'), ('total', '${all.length}');
${groups.map((g) => `INSERT INTO groups VALUES ('${esc(g.name)}', '${esc(g.display_name ?? g.title ?? g.name)}', ${g.package_count ?? 0});`).join('\n')}
`;
writeFileSync(resolve(OUT, 'seed-00.sql'), header);

const CHUNK = 4000;
let files = 1;
for (let i = 0; i < all.length; i += CHUNK) {
  const rows = all.slice(i, i + CHUNK).map((d) =>
    `INSERT OR REPLACE INTO datasets VALUES ('${esc(d.id)}','${esc(d.title)}','${esc(d.summary)}','${esc(d.org)}','${esc(d.tags)}','${esc(d.formats)}',${d.resources},'${esc(d.resources_list)}','${esc(d.license)}','${esc(d.updated)}','${esc(d.url)}');`
  );
  writeFileSync(resolve(OUT, `seed-${String(files).padStart(2, '0')}.sql`), rows.join('\n'));
  files++;
}
console.log(`  ✓ ${files} SQL files in scripts/.seed/`);

console.log('▶ pushing to D1 (remote)…');
const seedFiles = readdirSync(OUT).filter((f) => f.endsWith('.sql')).sort();
for (const f of seedFiles) {
  execSync(`npx wrangler d1 execute thai-open-data --remote --file="${resolve(OUT, f)}" -y`, {
    cwd: resolve(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`  ✓ ${f}`);
}
console.log(`✓ mirror synced — ${all.length} datasets, stamped ${stamp}`);
