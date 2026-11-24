// tests/api/unit.test.ts — the dependency-free upload and repo-proof helpers,
// run under bun without a tracker:
//   src/lib/multipart.ts  the streaming multipart parser (chunk boundaries,
//                         fields, the file part, limits, malformed bodies)
//   src/lib/sniff.ts      magic bytes and image sizes
//   src/lib/repoproof.ts  the .iosonand-verify check, with a stubbed fetch
//                         (the success path needs no GitHub push here)
//   src/lib/ratebuckets.ts which rate-limit bucket a request counts against,
//                         and that its limits match wrangler.jsonc

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MultipartError, boundaryOf, indexOfBytes, parseMultipart } from '../../src/lib/multipart';
import { imageSize, sniff } from '../../src/lib/sniff';
import { checkProofFile } from '../../src/lib/repoproof';
import { BUCKETS, bucketFor } from '../../src/lib/ratebuckets';
import { gpuFamily, gpuInfo, gpuMatches, gpuOfSoc } from '../../src/lib/gpu';

describe('GPU from the chip', () => {
  test('chips map to their GPU by part number or name; unknown chips stay empty', () => {
    expect(gpuOfSoc('Snapdragon 695 (SM6375)')).toBe('Adreno 619');
    expect(gpuOfSoc('Snapdragon 860 (SM8150-AC)')).toBe('Adreno 640');
    expect(gpuOfSoc('Snapdragon 865+ (SM8250-AB)')).toBe('Adreno 650');
    expect(gpuOfSoc('Snapdragon 8s Gen 3 (SM8635)')).toBe('Adreno 735');
    expect(gpuOfSoc('Snapdragon 8 Elite Gen 5 for Galaxy (SM8850)')).toBe('Adreno 840');
    expect(gpuOfSoc('Tensor G2 (GS201)')).toBe('Mali-G710 MP7');
    expect(gpuOfSoc('Helio P35 (MT6765)')).toBe('PowerVR GE8320');
    expect(gpuOfSoc('Exynos 2400')).toBe('Xclipse 940');
    expect(gpuOfSoc('Snapdragon 712 (SDM710)')).toBe('Adreno 616');
    expect(gpuOfSoc('Snapdragon 7s Gen 3 (SM7635)')).toBe('Adreno 810');
    expect(gpuOfSoc('MediaTek')).toBe('');
    expect(gpuOfSoc('')).toBe('');
  });
  test('families and drivers', () => {
    expect(gpuFamily('Adreno 619')).toEqual({ family: 'Adreno 6xx', driver: 'freedreno / Turnip (msm)' });
    expect(gpuFamily('Adreno 506').driver).toBe('freedreno (msm)');
    expect(gpuFamily('Mali-G57 MC2').family).toBe('Mali Valhall (JM)');
    expect(gpuFamily('Mali-G710 MP7')).toEqual({ family: 'Mali Valhall (CSF)', driver: 'Panthor' });
    expect(gpuFamily('Mali-G310 V2').family).toBe('Mali Valhall (CSF)');
    expect(gpuFamily('Mali-G52 MC2').family).toBe('Mali Bifrost');
    expect(gpuFamily('Mali-400 MP4').driver).toBe('Lima');
    expect(gpuFamily('Immortalis-G720 MC12').family).toBe('Mali 5th gen and later');
  });
  test("the device's own gpu wins; matching by model or family", () => {
    expect(gpuInfo({ soc: 'Snapdragon 845 (SDM845)' })).toMatchObject({ gpu: 'Adreno 630', gpu_source: 'chip', gpu_family: 'Adreno 6xx' });
    expect(gpuInfo({ soc: 'Snapdragon 845', gpu: 'Adreno 999' }).gpu_source).toBe('device');
    expect(gpuInfo({ soc: 'MediaTek' })).toMatchObject({ gpu: '', gpu_source: '', gpu_family: '' });
    const i = gpuInfo({ soc: 'Snapdragon 695' });
    for (const q of ['Adreno 619', 'adreno 6xx', 'adreno']) expect(gpuMatches(i, q)).toBe(true);
    for (const q of ['Adreno 618', 'Mali', '']) expect(gpuMatches(i, q)).toBe(false);
  });
});

describe('rate-limit buckets', () => {
  test('each request type lands in the right bucket', () => {
    expect(bucketFor('GET', '/api/devices')).toBe('read');
    expect(bucketFor('HEAD', '/api/auth/me')).toBe('read');
    for (const p of ['login', 'signup', 'register', 'link', 'password', 'password-reset', 'password-reset/confirm', 'gh-verify']) {
      expect(bucketFor('POST', `/api/auth/${p}`)).toBe('auth');
    }
    expect(bucketFor('POST', '/api/reddit/fetch')).toBe('expensive');
    expect(bucketFor('POST', '/api/repos/claim')).toBe('expensive');
    expect(bucketFor('POST', '/api/repos/claim/12/verify')).toBe('expensive');
    expect(bucketFor('POST', '/api/media')).toBe('upload');
    expect(bucketFor('DELETE', '/api/media/3')).toBe('write');
    expect(bucketFor('PUT', '/api/status/s24/display')).toBe('write');
    expect(bucketFor('POST', '/api/auth/logout')).toBe('write');
  });

  test('BUCKETS match the ratelimits bindings in wrangler.jsonc', () => {
    const text = readFileSync(path.join(import.meta.dir, '..', '..', 'wrangler.jsonc'), 'utf8');
    const bindings = new Map<string, number>();
    for (const m of text.matchAll(/"name":\s*"(RL_[A-Z_]+)"[^}]*?"limit":\s*(\d+),\s*"period":\s*(\d+)/g)) {
      expect(m[3]).toBe('60');
      bindings.set(m[1], Number(m[2]));
    }
    for (const { binding, limit } of Object.values(BUCKETS)) expect(bindings.get(binding)).toBe(limit);
    expect(bindings.size).toBe(Object.keys(BUCKETS).length);
  });
});

/** A stream that yields `bytes` in pieces of `size` (to cross every boundary). */
function streamOf(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream({
    pull(c) {
      if (o >= bytes.length) return c.close();
      c.enqueue(bytes.slice(o, o + size));
      o += size;
    },
  });
}

async function encode(fd: FormData): Promise<{ bytes: Uint8Array; boundary: string }> {
  const r = new Response(fd);
  const boundary = boundaryOf(r.headers.get('content-type'))!;
  return { bytes: new Uint8Array(await r.arrayBuffer()), boundary };
}

async function parse(bytes: Uint8Array, boundary: string, size: number, limits = {}) {
  const fields: Record<string, string> = {};
  const files: Array<{ name: string; filename: string; type: string; data: number[] }> = [];
  await parseMultipart(
    streamOf(bytes, size),
    boundary,
    {
      field: (n, v) => void (fields[n] = v),
      fileStart: (p) => void files.push({ name: p.name, filename: p.filename, type: p.contentType, data: [] }),
      fileData: (c) => void files[files.length - 1].data.push(...c),
      fileEnd: () => {},
    },
    limits,
  );
  return { fields, files };
}

describe('multipart parser', () => {
  test('fields and a binary file survive any chunking', async () => {
    const payload = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    // Put the delimiter's own bytes inside the file to test false matches.
    payload.set(new TextEncoder().encode('\r\n--not-the-boundary'), 100);
    const fd = new FormData();
    fd.append('device', 's24-ultra');
    fd.append('caption', 'héllo "quoted"\r\nline two');
    fd.append('file', new Blob([payload], { type: 'image/png' }), 'shot.png');
    const { bytes, boundary } = await encode(fd);
    for (const size of [1, 2, 3, 7, 64, 1000, bytes.length]) {
      const { fields, files } = await parse(bytes, boundary, size);
      expect(fields, `chunk ${size}`).toEqual({ device: 's24-ultra', caption: 'héllo "quoted"\r\nline two' });
      expect(files.length).toBe(1);
      expect(files[0]).toMatchObject({ name: 'file', filename: 'shot.png', type: 'image/png' });
      expect(files[0].data.length).toBe(payload.length);
      expect(Buffer.from(files[0].data).equals(Buffer.from(payload))).toBe(true);
    }
  });

  test('limits and malformed bodies are 400 MultipartError', async () => {
    const fd = new FormData();
    fd.append('caption', 'x'.repeat(100));
    const { bytes, boundary } = await encode(fd);
    await expect(parse(bytes, boundary, 16, { maxFieldBytes: 50 })).rejects.toBeInstanceOf(MultipartError);
    await expect(parse(bytes.slice(0, bytes.length - 10), boundary, 16)).rejects.toThrow(/ends early/);
    await expect(parse(new TextEncoder().encode('no boundary here'), boundary, 4)).rejects.toThrow(/boundary/);
    const many = new FormData();
    for (let i = 0; i < 5; i++) many.append(`f${i}`, 'v');
    const m = await encode(many);
    await expect(parse(m.bytes, m.boundary, 32, { maxParts: 3 })).rejects.toThrow(/more than 3/);
  });

  test('boundaryOf and indexOfBytes', () => {
    expect(boundaryOf('multipart/form-data; boundary=abc')).toBe('abc');
    expect(boundaryOf('multipart/form-data; boundary="a b"')).toBe('a b');
    expect(boundaryOf('application/json')).toBeNull();
    expect(boundaryOf(null)).toBeNull();
    const hay = new TextEncoder().encode('aab--xab--x');
    expect(indexOfBytes(hay, new TextEncoder().encode('b--x'))).toBe(2);
    expect(indexOfBytes(hay, new TextEncoder().encode('b--x'), 3)).toBe(7);
    expect(indexOfBytes(hay, new TextEncoder().encode('zz'))).toBe(-1);
  });
});

describe('sniff', () => {
  const b = (...x: Array<number | string>) =>
    new Uint8Array(x.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));
  test('allowed types by magic bytes', () => {
    expect(sniff(b(0xff, 0xd8, 0xff, 0xe0))?.type).toBe('image/jpeg');
    expect(sniff(b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.type).toBe('image/png');
    expect(sniff(b('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))?.type).toBe('image/webp');
    expect(sniff(b(0, 0, 0, 0x1c, 'ftypavif', 0, 0, 0, 0, 'avifmif1miaf'))?.type).toBe('image/avif');
    expect(sniff(b(0, 0, 0, 0x18, 'ftypisom', 0, 0, 2, 0, 'isomiso2'))?.type).toBe('video/mp4');
    expect(sniff(b(0, 0, 0, 0x14, 'ftypqt  ', 0, 0, 0, 0, 'qt  '))?.type).toBe('video/quicktime');
    expect(sniff(b(0, 0, 0, 8, 'moov'))?.type).toBe('video/quicktime');
    expect(sniff(b(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 'webm'))?.type).toBe('video/webm');
  });
  test('everything else is refused', () => {
    expect(sniff(b('GIF89a'))).toBeNull();
    expect(sniff(b('<svg xmlns'))).toBeNull();
    expect(sniff(b(0, 0, 0, 0x18, 'ftypheic', 0, 0, 0, 0, 'mif1heic'))).toBeNull();
    expect(sniff(b(0x1a, 0x45, 0xdf, 0xa3, 'matroska'))).toBeNull();
    expect(sniff(b('%PDF-1.7'))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });
  test('image sizes', () => {
    const png = b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'IHDR', 0, 0, 5, 0, 0, 0, 2, 0xd0);
    expect(imageSize('image/png', png)).toEqual({ width: 1280, height: 720 });
    // SOI, APP0 (len 16), SOF0: height 0x0438 = 1080, width 0x0780 = 1920.
    const jpg = b(0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x04, 0x38, 0x07, 0x80, 3);
    expect(imageSize('image/jpeg', jpg)).toEqual({ width: 1920, height: 1080 });
    const vp8x = b('RIFF', 0, 0, 0, 0, 'WEBPVP8X', 10, 0, 0, 0, 0, 0, 0, 0, 0x7f, 0x02, 0, 0xdf, 0x01, 0);
    expect(imageSize('image/webp', vp8x)).toEqual({ width: 640, height: 480 });
    expect(imageSize('image/png', b(1, 2, 3))).toBeNull();
  });
});

describe('repo proof file (stubbed fetch)', () => {
  const NONCE = 'iosonand-verify-abc123';
  const stub = (answers: Record<string, () => Response>) => {
    const seen: string[] = [];
    const f = async (url: string) => {
      seen.push(url);
      for (const [k, v] of Object.entries(answers)) if (url.startsWith(k)) return v();
      return new Response('Not Found', { status: 404 });
    };
    return { f, seen };
  };

  test('the raw file with the nonce (and a trailing newline) proves the claim', async () => {
    const { f, seen } = stub({ 'https://raw.githubusercontent.com/me/port/HEAD/.iosonand-verify': () => new Response(`${NONCE}\n`) });
    const r = await checkProofFile('me/port', NONCE, { fetch: f });
    expect(r.ok).toBe(true);
    expect(seen).toEqual(['https://raw.githubusercontent.com/me/port/HEAD/.iosonand-verify']);
  });

  test('a stale raw answer falls back to the contents API', async () => {
    const { f, seen } = stub({
      'https://raw.githubusercontent.com/': () => new Response('old-code'),
      'https://api.github.com/repos/me/port/contents/.iosonand-verify': () => new Response(NONCE),
    });
    const r = await checkProofFile('me/port', NONCE, { fetch: f, apiHeaders: { authorization: 'Bearer x' } });
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(2);
  });

  test('a missing or wrong file is not a proof', async () => {
    expect((await checkProofFile('me/port', NONCE, { fetch: stub({}).f })).ok).toBe(false);
    const wrong = await checkProofFile('me/port', NONCE, { fetch: stub({ 'https://': () => new Response('someone-else') }).f });
    expect(wrong).toMatchObject({ ok: false, found: 'someone-else' });
    const big = await checkProofFile('me/port', NONCE, { fetch: stub({ 'https://': () => new Response(`${NONCE}${'x'.repeat(100000)}`) }).f });
    expect(big.ok).toBe(false);
  });

  test('GitHub unreachable throws (the route answers 502)', async () => {
    await expect(checkProofFile('me/port', NONCE, { fetch: async () => { throw new Error('ECONNREFUSED'); } })).rejects.toThrow('ECONNREFUSED');
  });
});
