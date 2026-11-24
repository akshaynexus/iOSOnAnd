// tests/api/openapi.test.ts — the OpenAPI document (src/lib/openapi.ts)
// against the route files and against itself.
//
//   bun test tests/api                       # TRACKER_URL defaults to http://127.0.0.1:3001
//
// 1. Walks src/routes/api/**: every route path and every method its handlers
//    define must be an operation in the spec, and every spec operation must
//    have a handler (no stale entries).
// 2. Checks the document's structure: OpenAPI 3.1, unique operationIds,
//    declared path parameters, x-auth on every operation with a matching
//    security requirement, a 2xx JSON response, and every $ref resolving.
// 3. Checks the enums against src/lib/auth.ts.
// 4. Against the running tracker: GET /api/openapi.json is this document and
//    GET /api/docs lists the same endpoints (both are derived from it).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { SCOPES, scopeAllows, scopeFor } from '../../src/lib/scopes';
import {
  AUTH_LEVELS,
  CLAIM_STATUSES,
  OPERATIONS,
  REPO_KINDS,
  STATES,
  TITLES,
  VERIFIED,
  docsEndpoints,
  openapiDocument,
} from '../../src/lib/openapi';

const BASE = (process.env.TRACKER_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const ROOT = path.join(import.meta.dir, '..', '..');
const API_DIR = path.join(ROOT, 'src', 'routes', 'api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `/api/claims/$id/approve` -> `/api/claims/{id}/approve`. */
const toOpenApiPath = (p: string) => p.replace(/\$([A-Za-z_]\w*)/g, '{$1}');

interface RouteFile {
  file: string;
  path: string;
  methods: string[];
}

function routeFiles(): RouteFile[] {
  const out: RouteFile[] = [];
  for (const file of walk(API_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const m = /createFileRoute\(\s*['"]([^'"]+)['"]\s*\)/.exec(src);
    if (!m) throw new Error(`${file}: no createFileRoute('...')`);
    if (m[1] === '/api/$') continue; // the JSON 404 catch-all
    const handlers = src.slice(src.indexOf('handlers'));
    const methods = METHODS.filter((meth) => new RegExp(`\\b${meth}\\s*:`).test(handlers));
    out.push({ file: path.relative(ROOT, file), path: toOpenApiPath(m[1]), methods });
  }
  return out;
}

const doc = openapiDocument('http://tracker.test') as any;

function resolveRef(ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce<any>((node, key) => (node == null ? undefined : node[key.replace(/~1/g, '/').replace(/~0/g, '~')]), doc);
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

describe('OpenAPI spec covers the routes', () => {
  const routes = routeFiles();

  test('route files were found', () => {
    expect(routes.length).toBeGreaterThan(30);
    for (const r of routes) expect(r.methods.length, `${r.file} defines no handler`).toBeGreaterThan(0);
  });

  test('every route method is in the spec', () => {
    const missing: string[] = [];
    for (const r of routes) {
      for (const m of r.methods) {
        if (!doc.paths[r.path]?.[m.toLowerCase()]) missing.push(`${m} ${r.path} (${r.file})`);
      }
    }
    expect(missing, `add these to OPERATIONS in src/lib/openapi.ts:\n${missing.join('\n')}`).toEqual([]);
  });

  test('every spec operation has a handler', () => {
    const byPath = new Map(routes.map((r) => [r.path, r.methods]));
    const stale: string[] = [];
    for (const op of OPERATIONS) {
      if (!byPath.get(op.path)?.includes(op.method.toUpperCase())) stale.push(`${op.method.toUpperCase()} ${op.path}`);
    }
    expect(stale, `no handler for these spec operations:\n${stale.join('\n')}`).toEqual([]);
  });

  test('every operation has a sidebar title, and no title is stale', () => {
    const keys = OPERATIONS.map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(keys.filter((k) => !TITLES[k])).toEqual([]);
    expect(Object.keys(TITLES).filter((k) => !keys.includes(k))).toEqual([]);
  });

  test('no operation is listed twice', () => {
    const keys = OPERATIONS.map((o) => `${o.method} ${o.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('OpenAPI document structure', () => {
  test('top level', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(typeof doc.info?.title).toBe('string');
    expect(typeof doc.info?.version).toBe('string');
    expect(doc.servers?.[0]?.url).toBe('http://tracker.test');
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'iosonand_session' });
    expect(doc.components.schemas.Error.required).toEqual(['error']);
  });

  test('operations', () => {
    const ids = new Set<string>();
    const tags = new Set((doc.tags as Array<{ name: string }>).map((t) => t.name));
    for (const [p, item] of Object.entries<any>(doc.paths)) {
      expect(p.startsWith('/api/'), p).toBe(true);
      const templ = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries<any>(item)) {
        const where = `${method.toUpperCase()} ${p}`;
        expect(['get', 'post', 'put', 'patch', 'delete']).toContain(method);
        expect(typeof op.operationId, where).toBe('string');
        expect(ids.has(op.operationId), `duplicate operationId ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
        expect(typeof op.summary, where).toBe('string');
        for (const t of op.tags) expect(tags.has(t), `${where}: unknown tag ${t}`).toBe(true);

        // Auth level and security requirement agree.
        expect(Object.keys(AUTH_LEVELS), where).toContain(op['x-auth']);
        expect(Array.isArray(op.security), where).toBe(true);
        const schemes = op.security.flatMap((s: object) => Object.keys(s));
        if (op['x-auth'] === 'public') {
          expect(op.security.length === 0 || op.security.some((s: object) => Object.keys(s).length === 0), `${where}: public must not require auth`).toBe(true);
        } else {
          expect(schemes.sort(), where).toEqual(['bearerAuth', 'cookieAuth']);
          expect(op.security.some((s: object) => Object.keys(s).length === 0), `${where}: must require auth`).toBe(false);
          expect(op.responses['401'], `${where}: a login-only operation documents 401`).toBeDefined();
        }

        // Every {param} in the path is declared, and nothing else is.
        const declared = (op.parameters ?? [])
          .map((x: any) => (x.$ref ? resolveRef(x.$ref) : x))
          .filter((x: any) => x?.in === 'path')
          .map((x: any) => x.name);
        expect(declared.sort(), where).toEqual([...templ].sort());
        for (const x of op.parameters ?? []) {
          const prm: any = x.$ref ? resolveRef(x.$ref) : x;
          expect(prm, `${where}: unresolved parameter ${x.$ref}`).toBeDefined();
          expect(['path', 'query'], where).toContain(prm.in);
          expect(prm.schema, `${where}: parameter ${prm.name} has no schema`).toBeDefined();
          if (prm.in === 'path') expect(prm.required, where).toBe(true);
        }

        // A JSON 2xx (or, for a browser redirect, a 3xx with Location), and errors as {error, hint}.
        const codes = Object.keys(op.responses);
        const ok = codes.filter((c) => /^2\d\d$/.test(c));
        const redirects = codes.filter((c) => /^3\d\d$/.test(c));
        expect(ok.length + redirects.length, `${where}: no 2xx or 3xx response`).toBeGreaterThan(0);
        for (const c of ok) expect(op.responses[c].content?.['application/json']?.schema, `${where} ${c}`).toBeDefined();
        for (const c of redirects) expect(op.responses[c].headers?.Location, `${where} ${c}: a redirect needs Location`).toBeDefined();
        for (const c of codes.filter((c) => /^[45]\d\d$/.test(c))) {
          expect(op.responses[c].$ref, `${where} ${c}`).toBe(`#/components/responses/E${c}`);
        }
        if (op.requestBody) {
          const c = op.requestBody.content ?? {};
          expect(c['application/json']?.schema ?? c['multipart/form-data']?.schema, `${where}: a JSON or multipart body`).toBeDefined();
        }
        // The documented key scope is the one requireUser enforces.
        if (op['x-auth'] !== 'public') expect(op['x-scope'], where).toBe(scopeFor(method, p));
        if (['get', 'delete'].includes(method) && op.requestBody) expect(op.requestBody.required, `${where}: body must be optional`).toBe(false);
      }
    }
  });

  test('every $ref resolves', () => {
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(50);
    const broken = [...new Set(refs)].filter((r) => resolveRef(r) === undefined);
    expect(broken).toEqual([]);
  });

  test('error responses use the {error, hint} schema', () => {
    for (const [code, r] of Object.entries<any>(doc.components.responses)) {
      expect(r.content['application/json'].schema.$ref, code).toBe('#/components/schemas/Error');
    }
  });

  test('enums match src/lib/auth.ts', () => {
    const auth = readFileSync(path.join(ROOT, 'src', 'lib', 'auth.ts'), 'utf8');
    const list = (name: string) => {
      const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(auth);
      if (!m) throw new Error(`${name} not found in src/lib/auth.ts`);
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    expect(STATES).toEqual(list('STATES'));
    expect(CLAIM_STATUSES).toEqual(list('CLAIM_STATUSES'));
    expect(VERIFIED).toEqual(list('VERIFIED'));
    expect(REPO_KINDS).toEqual(list('REPO_KINDS'));
  });
});

describe('key scopes (src/lib/scopes.ts)', () => {
  test('the scope rule', () => {
    expect(scopeFor('GET', '/api/auth/me')).toBe('read');
    expect(scopeFor('PUT', '/api/status/s24-ultra/wifi')).toBe('status:write');
    expect(scopeFor('PATCH', '/api/devices/s24-ultra')).toBe('status:write');
    expect(scopeFor('DELETE', '/api/devices/s24-ultra')).toBe('all');
    expect(scopeFor('POST', '/api/forks/sync')).toBe('fork:write');
    expect(scopeFor('POST', '/api/repos/claim')).toBe('fork:write');
    expect(scopeFor('POST', '/api/posts')).toBe('post:write');
    expect(scopeFor('POST', '/api/reddit/fetch')).toBe('post:write');
    expect(scopeFor('POST', '/api/media')).toBe('media:write');
    expect(scopeFor('POST', '/api/tokens')).toBe('all');
    expect(scopeFor('POST', '/api/claims')).toBe('all');
    expect(scopeFor('POST', '/api/postsx')).toBe('all');
  });

  test('scopeAllows', () => {
    expect(scopeAllows(['all'], 'media:write')).toBe(true);
    expect(scopeAllows(['read'], 'read')).toBe(true);
    expect(scopeAllows(['status:write'], 'read')).toBe(true);
    expect(scopeAllows(['read'], 'status:write')).toBe(false);
    expect(scopeAllows(['status:write'], 'all')).toBe(false);
    expect(scopeAllows(['status:write', 'media:write'], 'media:write')).toBe(true);
  });

  test('the Scope schema lists every scope', () => {
    expect(doc.components.schemas.Scope.enum).toEqual([...SCOPES]);
  });
});

describe('served documents', () => {
  test('GET /api/openapi.json is the document, with this origin as the server', async () => {
    const r = await fetch(`${BASE}/api/openapi.json`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const origin = new URL(BASE).origin;
    expect(body.servers[0].url).toBe(origin);
    expect(body).toEqual(JSON.parse(JSON.stringify(openapiDocument(origin))));
  });

  test('GET /api/docs lists the spec operations', async () => {
    const r = await fetch(`${BASE}/api/docs`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.endpoints).toEqual(docsEndpoints());
    expect(body.auth_levels).toEqual(AUTH_LEVELS);
    // Every operation is in the list (joined methods like "PUT,POST" count).
    for (const op of OPERATIONS) {
      const p = op.path.replace(/\{([^}]+)\}/g, ':$1');
      const hit = body.endpoints.some(
        (e: any) => e.path.split('?')[0] === p && e.method.split(',').includes(op.method.toUpperCase()) && e.auth === op.auth,
      );
      expect(hit, `${op.method.toUpperCase()} ${op.path}`).toBe(true);
    }
  });

  test('/api-reference and /docs pages render', async () => {
    for (const p of ['/api-reference', '/docs', '/docs/sources', '/docs/agents', '/docs/maintain-a-repo', '/docs/api-keys', '/docs/api', '/docs/uploads', '/docs/permissions', '/docs/data-model']) {
      const r = await fetch(`${BASE}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-type') || '', p).toContain('text/html');
    }
  });
});
