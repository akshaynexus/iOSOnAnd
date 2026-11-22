// src/lib/multipart.ts — a streaming multipart/form-data parser for uploads.
//
// request.formData() buffers the whole body (up to 95 MB of video) in the
// Worker's 128 MB. This parser reads the body stream once and hands the file
// part to a sink chunk by chunk (src/lib/media.ts writes it to R2 in 8 MiB
// parts), so at most one part plus one stream chunk is held in memory.
// Text fields are capped (maxFieldBytes each, maxParts in all).
//
// Dependency-free: tests/api/media-unit.test.ts runs it under bun.

export class MultipartError extends Error {
  status: number;
  hint: string;
  constructor(status: number, message: string, hint: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

export interface FilePart {
  name: string;
  filename: string;
  contentType: string;
}

export interface MultipartHandler {
  field(name: string, value: string): void | Promise<void>;
  fileStart(part: FilePart): void | Promise<void>;
  fileData(chunk: Uint8Array): void | Promise<void>;
  fileEnd(): void | Promise<void>;
}

export interface MultipartLimits {
  maxFieldBytes?: number;
  maxParts?: number;
  maxHeaderBytes?: number;
}

/** The boundary from a Content-Type header; null when it is not multipart/form-data. */
export function boundaryOf(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType)) return null;
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return m ? m[1] ?? m[2] : null;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** First index of `needle` in `hay` at or after `from`; -1 when absent. */
export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  let i = hay.indexOf(first, from);
  while (i !== -1 && i <= last) {
    let j = 1;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
    i = hay.indexOf(first, i + 1);
  }
  return -1;
}

function headerParam(value: string, key: string): string | null {
  const m = new RegExp(`;\\s*${key}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(value) || new RegExp(`;\\s*${key}=([^;\\s]+)`, 'i').exec(value);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

const CRLF2 = new Uint8Array([13, 10, 13, 10]);

/**
 * Parse `body` and call `h` for every part, in order. A part with a filename
 * is a file (fileStart, fileData*, fileEnd); any other part is a text field.
 * Throws MultipartError(400) on malformed input or a limit hit.
 */
export async function parseMultipart(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  h: MultipartHandler,
  limits: MultipartLimits = {},
): Promise<void> {
  const maxField = limits.maxFieldBytes ?? 64 * 1024;
  const maxParts = limits.maxParts ?? 20;
  const maxHeader = limits.maxHeaderBytes ?? 16 * 1024;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const dashBoundary = enc.encode(`--${boundary}`);
  const delim = enc.encode(`\r\n--${boundary}`);
  const bad = (msg: string) => new MultipartError(400, msg, 'send multipart/form-data, e.g. curl -F file=@shot.png -F device=<slug>');

  const reader = body.getReader();
  let buf: Uint8Array = new Uint8Array(0);
  let ended = false;
  const pull = async (): Promise<boolean> => {
    if (ended) return false;
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      return false;
    }
    buf = concat(buf, value);
    return true;
  };

  let state: 'preamble' | 'after' | 'headers' | 'body' = 'preamble';
  let parts = 0;
  let cur: { name: string; file: boolean; chunks: Uint8Array[]; len: number } | null = null;
  try {
    for (;;) {
      if (state === 'preamble') {
        const i = indexOfBytes(buf, dashBoundary);
        if (i < 0) {
          if (buf.length > maxHeader) throw bad('no multipart boundary found');
          if (!(await pull())) throw bad('no multipart boundary found');
          continue;
        }
        buf = buf.subarray(i + dashBoundary.length);
        state = 'after';
      } else if (state === 'after') {
        if (buf.length < 2) {
          if (!(await pull())) throw bad('multipart body ends early');
          continue;
        }
        if (buf[0] === 45 && buf[1] === 45) return; // "--": the close delimiter; the epilogue is ignored
        // Transport padding (spaces, tabs) may sit before the CRLF.
        let k = 0;
        while (k < buf.length && (buf[k] === 32 || buf[k] === 9)) k++;
        if (k + 2 > buf.length) {
          if (!(await pull())) throw bad('multipart body ends early');
          continue;
        }
        if (buf[k] !== 13 || buf[k + 1] !== 10) throw bad('malformed multipart delimiter');
        buf = buf.subarray(k + 2);
        state = 'headers';
      } else if (state === 'headers') {
        const i = indexOfBytes(buf, CRLF2);
        if (i < 0) {
          if (buf.length > maxHeader) throw bad('multipart part headers too long');
          if (!(await pull())) throw bad('multipart body ends early');
          continue;
        }
        if (++parts > maxParts) throw bad(`more than ${maxParts} multipart parts`);
        const head = dec.decode(buf.subarray(0, i));
        buf = buf.subarray(i + 4);
        let disposition = '';
        let ctype = 'application/octet-stream';
        for (const line of head.split('\r\n')) {
          const c = line.indexOf(':');
          if (c < 0) continue;
          const k = line.slice(0, c).trim().toLowerCase();
          const v = line.slice(c + 1).trim();
          if (k === 'content-disposition') disposition = v;
          else if (k === 'content-type') ctype = v;
        }
        if (!/^form-data\b/i.test(disposition)) throw bad('a multipart part has no Content-Disposition: form-data');
        const name = headerParam(disposition, 'name') ?? '';
        const filename = headerParam(disposition, 'filename');
        cur = { name, file: filename !== null, chunks: [], len: 0 };
        if (cur.file) await h.fileStart({ name, filename: filename ?? '', contentType: ctype });
        state = 'body';
      } else {
        const i = indexOfBytes(buf, delim);
        const emitUpTo = i >= 0 ? i : buf.length - (delim.length - 1);
        if (emitUpTo > 0 && cur) {
          const chunk = buf.subarray(0, emitUpTo);
          if (cur.file) await h.fileData(chunk);
          else {
            cur.len += chunk.length;
            if (cur.len > maxField) throw bad(`field ${cur.name || '(unnamed)'} is over ${maxField} bytes`);
            cur.chunks.push(chunk.slice());
          }
          buf = buf.subarray(emitUpTo);
        }
        if (i >= 0) {
          buf = buf.subarray(delim.length);
          if (cur) {
            if (cur.file) await h.fileEnd();
            else {
              let all: Uint8Array = new Uint8Array(0);
              for (const c of cur.chunks) all = concat(all, c);
              await h.field(cur.name, dec.decode(all));
            }
          }
          cur = null;
          state = 'after';
          continue;
        }
        if (!(await pull())) throw bad('multipart body ends early (no closing boundary)');
      }
    }
  } finally {
    if (!ended) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
    }
  }
}
