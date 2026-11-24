#!/usr/bin/env node
// Load the Android device catalog (device_catalog) from Google Play's list of
// every certified Android device.
//
//   node scripts/sync-catalog.mjs [--local|--remote] [--file supported_devices.csv] [--dry-run]
//
// Source: https://storage.googleapis.com/play_public/supported_devices.csv
// (UTF-16 CSV: Retail Branding, Marketing Name, Device, Model; Google updates
// it daily). Rows without a marketing name are dropped; the rest are grouped
// by brand and marketing name, with their codenames (Device) and model
// numbers joined; TVs, boxes, car units and watches are dropped (they share
// platform codenames with phones). The table is replaced as a whole, so a rerun picks up new
// phones. The catalog is what /api/catalog searches when someone adds a phone
// the tracker does not list yet; it holds no tracker data. Default --local.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const REMOTE = argv.includes('--remote');
const DRY = argv.includes('--dry-run');
const FILE = flag('--file', null);
const SOURCE = 'https://storage.googleapis.com/play_public/supported_devices.csv';

/** The brand as people say it. */
const BRAND = { LGE: 'LG', 'TCT (Alcatel)': 'Alcatel', 'Sony Mobile': 'Sony', 'HMD Global': 'Nokia', 'Xiaomi Communications': 'Xiaomi' };

/** A minimal CSV parser (quoted fields, "" escapes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const buf = FILE ? readFileSync(FILE) : Buffer.from(await (await fetch(SOURCE, { headers: { 'user-agent': 'iosonand-catalog/1' } })).arrayBuffer());
const text = new TextDecoder(buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : 'utf-8').decode(buf).replace(/^﻿/, '');
const rows = parseCsv(text).slice(1);

const groups = new Map();
for (const [brandRaw, nameRaw, device, model] of rows) {
  const name = (nameRaw || '').trim().replace(/\s+/g, ' ');
  if (!name) continue;
  const brand = BRAND[(brandRaw || '').trim()] ?? (brandRaw || '').trim();
  const key = `${brand.toLowerCase()}|${name.toLowerCase()}`;
  if (!groups.has(key)) groups.set(key, { brand, name, codenames: new Set(), models: new Set() });
  const g = groups.get(key);
  if (device?.trim()) g.codenames.add(device.trim());
  if (model?.trim()) g.models.add(model.trim());
}

// Phones and tablets only: TVs, set-top boxes, projectors, car units and
// watches share platform codenames with phones and would crowd the search.
const NOT_HANDHELD = /\b(tv|smart ?tv|android ?tv|google ?tv|box|stb|set[- ]?top|projector|beamer|stick|dongle|chromecast|streamer|car|auto|carplay|vehicle|watch|wear|monitor|signage|kiosk|pos|scanner|printer|soundbar|speaker|mirror)\b/i;
const handheld = (g) =>
  g.name.toLowerCase() !== g.brand.toLowerCase() && !/TV/.test(g.name) && !NOT_HANDHELD.test(g.name) && ![...g.models].some((m) => NOT_HANDHELD.test(m));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = [...groups.values()].filter(handheld).sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
const stmts = ['DELETE FROM device_catalog;'];
for (let i = 0; i < list.length; i += 200) {
  const part = list.slice(i, i + 200).map((g, j) => {
    const codenames = [...g.codenames].slice(0, 20).join(',');
    const models = [...g.models].slice(0, 30).join(',');
    // The name also without punctuation, so "moto g7" finds "moto g(7)".
    const plain = g.name.replace(/[()\-_]/g, ' ').replace(/[()]/g, '').replace(/\s+/g, ' ');
    const squeezed = g.name.replace(/[()]/g, '');
    const search = `${g.brand} ${g.name} ${plain} ${squeezed} ${codenames} ${models}`.toLowerCase().replace(/,/g, ' ');
    return `(${i + j + 1}, ${q(g.brand)}, ${q(g.name)}, ${q(codenames)}, ${q(models)}, ${q(search)})`;
  });
  stmts.push(`INSERT INTO device_catalog (id, brand, name, codenames, models, search) VALUES\n${part.join(',\n')};`);
}

console.log(JSON.stringify({ source: FILE ?? SOURCE, rows: rows.length, phones: list.length, target: REMOTE ? 'remote' : 'local', dry_run: DRY }));
if (DRY) process.exit(0);

const file = path.join(os.tmpdir(), `iosonand-catalog-${process.pid}.sql`);
writeFileSync(file, stmts.join('\n') + '\n');
const localBin = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const args = ['d1', 'execute', 'oneios-tracker', REMOTE ? '--remote' : '--local', '--yes', '--file', file];
try {
  existsSync(localBin)
    ? execFileSync(localBin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
    : execFileSync('bunx', ['wrangler', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  console.log(`loaded ${list.length} phones and tablets into device_catalog (${REMOTE ? 'remote' : 'local'})`);
} finally {
  unlinkSync(file);
}
