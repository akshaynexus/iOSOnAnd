// src/lib/sniff.ts — the upload type check: magic bytes, never the file name
// or the client's Content-Type. Dependency-free (tests/api/media-unit.test.ts
// imports it outside the Worker).
//
//   image/jpeg   FF D8 FF
//   image/png    89 50 4E 47 0D 0A 1A 0A
//   image/webp   "RIFF" <size> "WEBP"
//   image/avif   ISO-BMFF "ftyp" with brand avif or avis
//   video/mp4    ISO-BMFF "ftyp" with an MP4 brand (isom, mp41, mp42, avc1, ...)
//   video/quicktime  "ftyp" brand "qt  ", or a leading moov/mdat/wide/free atom
//   video/webm   EBML 1A 45 DF A3 with DocType "webm"
//
// Limits: images 15 MB, videos 95 MB (the Workers request body limit is
// 100 MB; the multipart framing needs the rest).

export const IMAGE_MAX = 15 * 1024 * 1024;
export const VIDEO_MAX = 95 * 1024 * 1024;
/** The whole multipart request, framing included. */
export const REQUEST_MAX = 95 * 1024 * 1024 + 64 * 1024;

export interface Sniffed {
  type: string;
  kind: 'image' | 'video';
  ext: string;
  max: number;
}

const TYPES: Record<string, Sniffed> = {
  'image/jpeg': { type: 'image/jpeg', kind: 'image', ext: 'jpg', max: IMAGE_MAX },
  'image/png': { type: 'image/png', kind: 'image', ext: 'png', max: IMAGE_MAX },
  'image/webp': { type: 'image/webp', kind: 'image', ext: 'webp', max: IMAGE_MAX },
  'image/avif': { type: 'image/avif', kind: 'image', ext: 'avif', max: IMAGE_MAX },
  'video/mp4': { type: 'video/mp4', kind: 'video', ext: 'mp4', max: VIDEO_MAX },
  'video/quicktime': { type: 'video/quicktime', kind: 'video', ext: 'mov', max: VIDEO_MAX },
  'video/webm': { type: 'video/webm', kind: 'video', ext: 'webm', max: VIDEO_MAX },
};

export const ALLOWED_TYPES = Object.keys(TYPES);

const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'M4V ', 'msnv',
  'f4v ', 'mmp4', 'hvc1', 'hev1', 'av01', 'cmfc', 'cmf2',
]);

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];

/** The detected type of a file from its first bytes (16 are enough, 64 is better); null when not allowed. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return TYPES['image/jpeg'];
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return TYPES['image/png'];
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return TYPES['image/webp'];
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    // EBML: the DocType element (0x4282) names webm or matroska.
    const head = ascii(b, 0, Math.min(b.length, 64));
    return head.includes('webm') ? TYPES['video/webm'] : null;
  }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const size = Math.min(u32(b, 0) || b.length, b.length);
    const brands = [ascii(b, 8, 4)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4));
    if (brands.some((x) => x === 'avif' || x === 'avis')) return TYPES['image/avif'];
    if (brands[0] === 'qt  ') return TYPES['video/quicktime'];
    if (brands.some((x) => MP4_BRANDS.has(x))) return TYPES['video/mp4'];
    return null; // heic, 3gp, m4a ...
  }
  if (b.length >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(b, 4, 4))) return TYPES['video/quicktime'];
  return null;
}

/** Width and height from the bytes held (the whole file for images under 8 MB); null when not found. */
export function imageSize(type: string, b: Uint8Array): { width: number; height: number } | null {
  try {
    if (type === 'image/png' && b.length >= 24 && ascii(b, 12, 4) === 'IHDR') {
      return { width: u32(b, 16), height: u32(b, 20) };
    }
    if (type === 'image/jpeg') {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) return null;
        const marker = b[o + 1];
        if (marker === 0xff) {
          o += 1;
          continue;
        }
        const len = u16(b, o + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: u16(b, o + 5), width: u16(b, o + 7) };
        }
        o += 2 + len;
      }
      return null;
    }
    if (type === 'image/webp' && b.length >= 30) {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (chunk === 'VP8L') {
        const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (type === 'image/avif') {
      // The first 'ispe' (image spatial extents) property: version/flags, width, height.
      for (let o = 4; o + 16 <= Math.min(b.length, 1 << 16); o++) {
        if (b[o] === 0x69 && b[o + 1] === 0x73 && b[o + 2] === 0x70 && b[o + 3] === 0x65) {
          return { width: u32(b, o + 8), height: u32(b, o + 12) };
        }
      }
    }
  } catch {
    /* truncated header */
  }
  return null;
}
