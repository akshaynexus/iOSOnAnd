#!/usr/bin/env node
/**
 * iOSOnAnd tracker CLI. Zero dependencies: node builtins only.
 *
 * Node 18 or newer (fetch, FormData and Blob are builtins there).
 * Get it from a tracker: curl -fsSLo cli.mjs https://<tracker>/cli.mjs
 *
 * Tracker URL, in order: --url URL, TRACKER_URL env, http://localhost:3000.
 * Token, in order: --token ion_... (anywhere on the line), TRACKER_TOKEN env,
 * ~/.config/iosonand/tokens.json (one token per tracker URL, mode 0600), the
 * legacy ~/.config/iosonand/token file. An API key from keys-create (with
 * scopes) works the same way as the login token.
 *
 * Exit codes: 0 ok, 1 server or validation error, 2 usage error.
 * Run `node ./cli.mjs --help` for the command list.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_URL = "http://localhost:3000";
const CONFIG_DIR = path.join(os.homedir(), ".config", "iosonand");
const TOKENS_FILE = path.join(CONFIG_DIR, "tokens.json");
const LEGACY_TOKEN_FILE = path.join(CONFIG_DIR, "token");
const STATES = ["works", "broken", "in-progress", "unknown"];
const CLAIM_STATUSES = ["pending", "approved", "rejected"];
const SCOPES = ["all", "read", "status:write", "fork:write", "post:write", "media:write"];
const SUPPORT_LEVELS = ["primary", "merged", "ported", "claimed"];
const RELATIONS = ["fork-of", "derived-from", "ported-from", "uses"];
const WRITE_COMMANDS = new Set([
  "status-set", "device-add", "device-set", "fork-add", "fork-sync", "post-add",
  "claim-add", "claim-approve", "claim-reject", "reddit-fetch", "post-set",
  "repo-claim", "repo-add", "repo-support", "repo-lineage", "media-upload", "update", "repo-maintainer-add", "repo-maintainer-remove",
  "feature-add", "feature-set", "feature-remove", "media-link", "gpu-set", "gpu-issue-add", "gpu-issue-set", "gpu-issue-remove",
]);
let TOKEN_FLAG = null;

let TRACKER_URL = DEFAULT_URL;
let URL_FROM = "default";

/* ------------------------------------------------------------------ */
/* Errors and output                                                   */
/* ------------------------------------------------------------------ */

class CliError extends Error {
  constructor(message, code = 1, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
const usage = (msg) => new CliError(msg, 2);
const invalid = (msg) => new CliError(msg, 1);

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}
function info(msg) {
  console.error(msg);
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

function readTokens() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    return t && typeof t === "object" ? t : {};
  } catch {
    return {};
  }
}

function tokenSource() {
  if (TOKEN_FLAG) return { from: "--token", token: TOKEN_FLAG };
  if (process.env.TRACKER_TOKEN) return { from: "env TRACKER_TOKEN", token: process.env.TRACKER_TOKEN.trim() };
  const t = readTokens()[TRACKER_URL];
  if (t) return { from: TOKENS_FILE, token: t };
  try {
    const legacy = fs.readFileSync(LEGACY_TOKEN_FILE, "utf8").trim();
    if (legacy) return { from: LEGACY_TOKEN_FILE, token: legacy };
  } catch { /* none */ }
  return { from: "none", token: null };
}

function writeTokens(all) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(TOKENS_FILE, 0o600);
}

function saveToken(token) {
  const all = readTokens();
  all[TRACKER_URL] = token.trim();
  writeTokens(all);
}

function removeToken() {
  const all = readTokens();
  if (!(TRACKER_URL in all)) return false;
  delete all[TRACKER_URL];
  writeTokens(all);
  return true;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

async function api(p, { method = "GET", body = undefined, auth = false, cookie = null, raw = false, form = null } = {}) {
  // form: a FormData (uploads); fetch sets the multipart Content-Type and length.
  const headers = form ? {} : { "content-type": "application/json" };
  if (auth) {
    const { token } = tokenSource();
    if (!token) {
      throw invalid(
        `not logged in to ${TRACKER_URL}. Run \`node ./cli.mjs login\` (local dev: \`login --admin\`), or set TRACKER_TOKEN.`,
      );
    }
    headers.authorization = `Bearer ${token}`;
  }
  if (cookie) headers.cookie = cookie;
  let res;
  try {
    res = await fetch(TRACKER_URL + p, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      ...(form ? { duplex: "half" } : {}),
    });
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
    throw new CliError(
      `cannot reach the tracker at ${TRACKER_URL} (${why}).\n` +
        `  Local dev: start it with \`bun run dev\`.\n` +
        `  Another tracker: pass --url URL or set TRACKER_URL (now from ${URL_FROM}).`,
      1,
      { unreachable: true },
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (raw) return { res, data };
  if (!res.ok) {
    const err = data.error || `HTTP ${res.status}`;
    let hint = data.hint || "";
    if (!hint && res.status === 401) hint = "run `node ./cli.mjs login` for this tracker, or set TRACKER_TOKEN";
    if (!hint && data.raw !== undefined) hint = "the server did not answer with JSON; check --url";
    throw new CliError(`${method} ${TRACKER_URL}${p} -> ${res.status} ${err}${hint ? `\n  hint: ${hint}` : ""}`, 1, {
      status: res.status,
    });
  }
  return data;
}

function isLocalUrl(u) {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Arguments and prompts                                               */
/* ------------------------------------------------------------------ */

const BOOLEAN_FLAGS = new Set(["admin", "register", "token", "help", "no-check"]);

/** Parse argv into { positionals, flags }. Supports --key value, --key=value, --flag. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      flags.help = true;
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        if (!BOOLEAN_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
          const v = argv[++i];
          // --photo may be given more than once: the files collect in a list.
          flags[k] = k === "photo" && flags[k] !== undefined ? [].concat(flags[k], v) : v;
        } else {
          flags[k] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** The --photo files: repeated flags, or one comma-separated list. Each must exist (checked before any write). */
function photosOf(flags) {
  const files = [].concat(flags.photo ?? []).filter((v) => typeof v === "string").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  if (files.length > 10) throw usage("at most 10 --photo files");
  for (const f of files) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      throw invalid(`no such file: ${f}`);
    }
    if (!st.isFile()) throw invalid(`not a file: ${f}`);
  }
  return files;
}

/** Upload each file linked to a status change or a feature; returns the media rows with full URLs. */
async function uploadLinked(files, device, link) {
  const media = [];
  for (const f of files) {
    info(`uploading ${f}...`);
    const m = await uploadFile(f, device, link);
    media.push({ ...m, url: TRACKER_URL + m.url });
  }
  return media;
}

function str(flags, name) {
  const v = flags[name];
  return typeof v === "string" ? v : "";
}

function checkState(state) {
  if (!STATES.includes(state)) {
    throw invalid(`invalid state ${JSON.stringify(state)}. Must be one of: ${STATES.join(" | ")}`);
  }
}

/** ios (the default; ipados counts as ios), macos, tvos; with `all`, also "all" (for reads). */
function checkOs(os, all = false) {
  const v = String(os).toLowerCase();
  if (v === "ipados" || v === "iphoneos") return "ios";
  const ok = ["ios", "macos", "tvos", ...(all ? ["all"] : [])];
  if (!ok.includes(v)) throw invalid(`invalid --os ${JSON.stringify(os)}. Must be one of: ${ok.join(" | ")}`);
  return v;
}

async function checkArea(area) {
  const r = await api("/api/areas");
  const slugs = (r.areas || []).map((a) => a.slug);
  if (slugs.length && !slugs.includes(area)) {
    throw invalid(`unknown area ${JSON.stringify(area)}. Valid slugs (from ${TRACKER_URL}/api/areas):\n  ${slugs.join(" ")}`);
  }
}

/** Hidden password prompt on a TTY. Agents set TRACKER_PASSWORD instead. */
function promptHidden(promptText) {
  if (!process.stdin.isTTY) {
    return Promise.reject(usage("no TTY for a password prompt. Set TRACKER_PASSWORD."));
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(buf);
    };
    const onData = (s) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u0003") return done(usage("cancelled"));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function getPassword(flags, promptText) {
  if (typeof flags.password === "string") {
    info("warning: --password puts the password in shell history. Prefer TRACKER_PASSWORD or the prompt.");
    return flags.password;
  }
  if (process.env.TRACKER_PASSWORD) return process.env.TRACKER_PASSWORD;
  return promptHidden(promptText);
}

function run(cmd, args, { input = undefined } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (r.error) throw invalid(`cannot run \`${cmd}\`: ${r.error.message}. Is it installed and on PATH?`);
  if (r.status !== 0) throw invalid(`\`${cmd} ${args.join(" ")}\` failed: ${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout || "").trim();
}

/** Read KEY=VALUE pairs from .dev.vars (cwd first, then next to this script). */
function readDevVars() {
  for (const dir of [process.cwd(), path.dirname(SCRIPT)]) {
    const f = path.join(dir, ".dev.vars");
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const vars = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return { file: f, vars };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

function help() {
  return `iOSOnAnd tracker CLI (node builtins only)

Tracker: ${TRACKER_URL}  (from ${URL_FROM})
  Set with --url URL or TRACKER_URL. The default ${DEFAULT_URL} is local dev (\`bun run dev\`).

Login (the token is stored per tracker URL in ~/.config/iosonand/tokens.json):
  login                     GitHub gist-proof login via \`gh\` (production path)
  login --email ADDR [--register]
                            email + password. Password from TRACKER_PASSWORD or a
                            hidden prompt. --register signs up when the login fails.
  login --admin             local dev only: log in as ADMIN_EMAIL / ADMIN_PASSWORD
                            from .dev.vars (signs up on a fresh DB)
  login --token             exchange \`gh auth token\` (warned: sends a GitHub token)
  link --email ADDR         bind your gh identity to an email account (gist-proof)
  whoami                    login, email, admin flag, devices you maintain
  logout                    forget the token for this tracker
  tokens                    token source and validity (value masked)

Reads (no login):
  areas                                      the valid area slugs
  status-get [--device SLUG] [--area SLUG] [--state STATE] [--os ios|macos|tvos|all]
  history <device> [--limit N]                what changed on the phone: each status
                                             change, before and after, who and when
  features <device>                          other notable features: what the
                                             checklist does not list, or uncommon
                                             hardware that works
  fork-list [--device SLUG]
  post-list [--limit N]
  claim-list [--device SLUG] [--status pending|approved|rejected]

Writes (login required; on 403 or 409 the server's error and hint are printed):
  status-set <device> <area> <state> --detail TEXT --source REF [--os ios|macos|tvos] [--version V]
                            admin, or a maintainer (approved claim) of <device>.
                            --os: the system it is about (ios, the default, also
                            covers iPadOS); --version: the version it was seen on,
                            e.g. "iOS 27.2" or "macOS 27.2"; --photo FILE (repeat it,
                            up to 10): screenshots or clips linked to this change
  feature-add <device> "<name>" [<state>] --detail TEXT --source REF [--os ios|macos|tvos] [--photo FILE ...]
                            a notable feature (state defaults to works), e.g.
                            feature-add s9 "IR blaster" works --detail "..." --source URL
  feature-set <device> <id> [--state S] [--name N] [--detail T] [--source R] [--os OS] [--photo FILE ...]
  feature-remove <device> <id>
  gpu-set <device> --method M --stack "A -> B -> C" --fps 40-58 --fps-note T [--repos R,...] --detail T --source REF [--version V]
                            how the GPU acceleration works and how fast: M is
                            native-metal, metal-vulkan (metal2vulkan on Turnip or
                            PanVK), metal-gl, gles (OpenGL ES only), virtio-gpu
                            (forwarded to Android's GPU), cpu or other
  gpu-get <device>          the GPU, its family, the open driver, that record and its issues
  gpu-issue-add <device> "<symptom>" --kind K [--state open|workaround|fixed] --cause T [--fix T] --source REF
                            a known GPU issue; K is white-widgets (HEIC snapshots fail:
                            no hardware HEVC encoder), black-ui (black widgets, blurs or
                            lock screen: a failing Metal path), gpu-fault, out-of-memory,
                            artifacts, slow, crash or other
  gpu-issue-set <device> <id> --state fixed --fix "..."   update one (any field)
  gpu-issue-remove <device> <id>
  gpu-issues [<device>] [--kind K] [--state S] [--q words]
                            known GPU issues on every phone (or one): who hit the same
                            symptom, the cause and the fix (no login)

Porting records (UniXNU's device records, as on unixnu.com/devices; no login):
  porting <device> | --repo R | --codename C | --component Adreno740 | --area gpu --status device-verified
                            each port repo's per-area status (device-verified,
                            host-verified, implemented, planned), best first
  porting-get <record>      one record in full: per area the components, what it
                            achieved, limits, next step, build/boot commands, evidence
  components [words]        the framework's drivers (e.g. components wifi, components
                            adreno): what each drives, its repo, and the boards
                            using it with that area's status
  claim-add <device> [--note TEXT]           ask to maintain a device (any login)
  claim-approve <id>, claim-reject <id>      admin only
  fork-add --repo OWNER/REPO [--device SLUG] [--branch B] [--fork-url URL]
           [--best-result T] [--ported T] [--fork-only T] [--notes T]
  fork-sync --repo OWNER/REPO [--device SLUG] --best-result TEXT
  post-add --title TEXT --link URL [--published DATE] [--note TEXT] [--image-url URL]
                            admin or any maintainer
  post-set <id> [--image-url URL] [--image-width N] [--image-height N] [--title T] [--note T]
                            admin: the post's thumbnail and text
  device-add <slug> [--name N] [--model M] [--soc S] [--repo-kind K]
             [--status STATE] [--best-result T] [--notes T]   admin only
  reddit-fetch [SUBREDDIT]                   admin only, default hackios
  user-add <email> [--admin]                 admin only, password as for login

Repos (a repo you own on GitHub is yours at once; else a proof file):
  repo-claim OWNER/REPO [--device SLUG] [--note TEXT]
                            claim a repo. Prints a verification code when GitHub
                            does not show you as the owner: write it alone to
                            .iosonand-verify on the default branch, push, then
  repo-verify <claim id>    check the file and approve the claim
  repo-add OWNER/REPO --device SLUG [--branch B] [--best-result T] [--note T]
                            add an untracked repo and claim it in one step
  repo-add OWNER/REPO --new-device "Phone name" [--model CODENAME] [--soc CHIP]
                            a phone the tracker does not list yet (your own repo only)
  references [--chip TEXT] [--gpu TEXT] [--device SLUG] [--area AREA] [--limit N]
                            ports to start from and borrow parts from: phones on a
                            chip, on a GPU or GPU family (--gpu "Adreno 619",
                            "Adreno 6xx", "Mali Valhall"), or where an area (metal,
                            gles, gpu, wifi, audio...) works, with their repos,
                            branch links, GPU work and sources (no login needed)
  catalog <name, codename or model>
                            search every Android phone and tablet (Google Play's
                            list); prints the repo-add line to use for each
  repo-claims [--status pending|approved|rejected|expired]
                            your claims, and the claims on repos you maintain
  repo-claim-approve <id>, repo-claim-reject <id>
                            an admin, or a maintainer of that repo (a collaborator
                            who claimed it joins the repo's maintainers)
  repo-maintainers OWNER/REPO                        everyone who maintains it
  repo-maintainer-add OWNER/REPO --github LOGIN      add a collaborator (a maintainer
                                                     or admin; they need an account
                                                     linked to that GitHub login)
  repo-maintainer-remove OWNER/REPO --github LOGIN   the repo's GitHub owner or an admin
  repo-unmaintain OWNER/REPO                         step down yourself
  repo-support OWNER/REPO <device> --support merged|ported|claimed|primary
               [--via OWNER/REPO] [--note T]          admin; maintainer: claimed
  repo-lineage OWNER/REPO --base X --relation fork-of|derived-from|ported-from|uses
               [--note T] [--source URL] [--base-project NAME]   admin or maintainer
  lineage                   the repo family tree (nodes and edges)

API keys (use one with TRACKER_TOKEN=ion_... or --token ion_...):
  keys                      list your keys (never the secret)
  keys-create --name N [--scopes status:write,media:write] [--expires-days 30|90|365]
                            prints the secret once. Scopes: ${SCOPES.join(" | ")}
  keys-revoke <id>, keys-rotate <id>

Media (proof screenshots and clips; images 15 MB, videos 95 MB):
  update <device> [photo-or-clip ...] --text "what changed" [--area A]
                            a photo update: uploads the files and posts them with
                            the text on the phone's page (maintainers; up to 10 files)
  updates <device>          the phone's updates, newest first
  media-upload <file> --device SLUG [--area A] [--history ID] [--feature ID] [--fork-id N] [--caption T]
                            --history: the status change it proves (ids: history);
                            --feature: the notable feature it shows (ids: features)
  media-link <id> [--history ID|none] [--feature ID|none] [--caption T]
                            link an upload to a status change or a feature (the
                            uploader, an admin or a maintainer of the phone)
  media-list [--device SLUG] [--area A] [--history ID] [--feature ID] [--fork-id N] [--limit N]
  media-delete <id>         the uploader or an admin

Devices (admin):
  device-set <slug> [--gpu G] [--base oneios|other] [--ios-version V] [--image-url URL]
             [--image-credit T] [--image-license L] [--image-source-url URL]
                            --gpu (a maintainer may set it too): the GPU when the
                            chip table gets it wrong, e.g. --gpu "Adreno 619"

Offline:
  queue <write command> [args]  append the command to ./TRACKER_QUEUE.md
                                (or $TRACKER_QUEUE) without sending it
  flush                         send the queued commands in order; sent lines
                                are removed, failed ones stay

Meta:
  check                     API reachable, areas seeded, devices readable, login
  Global: --url URL, --token ion_... (or TRACKER_TOKEN)
  help, --help

States: ${STATES.join(" | ")}
Exit codes: 0 ok, 1 server or validation error, 2 usage error.
`;
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

async function emailLogin(email, password, { register = false } = {}) {
  const attempt = (p) => api(p, { method: "POST", body: { email, password }, raw: true });
  let { res, data } = await attempt("/api/auth/login");
  let registered = false;
  if (res.status === 401 && register) {
    ({ res, data } = await attempt("/api/auth/register"));
    registered = res.ok;
  }
  if (!res.ok) {
    throw invalid(
      `login to ${TRACKER_URL} failed: ${res.status} ${data.error || ""}${data.hint ? `\n  hint: ${data.hint}` : ""}`,
    );
  }
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie.includes("=")) throw invalid("the server sent no session cookie");
  const t = await api("/api/auth/tokens", { method: "POST", cookie, body: { name: "cli" } });
  if (!t.token) throw invalid("the server returned no token from POST /api/auth/tokens");
  saveToken(t.token);
  return { registered, user: data.user || null };
}

async function cmdLogin(flags) {
  if (flags.admin) {
    if (!isLocalUrl(TRACKER_URL)) {
      throw usage(`login --admin is for local dev only, and ${TRACKER_URL} is not localhost. Use login or login --email.`);
    }
    const dv = readDevVars();
    if (!dv) throw invalid("no .dev.vars here or next to cli.mjs. Run `bun run setup` (or `bun run dev`) first.");
    const email = dv.vars.ADMIN_EMAIL;
    const password = dv.vars.ADMIN_PASSWORD;
    if (!email || !password) throw invalid(`ADMIN_EMAIL or ADMIN_PASSWORD is empty in ${dv.file}`);
    const r = await emailLogin(email, password, { register: true });
    const isAdmin = !!(r.user && r.user.is_admin);
    if (!isAdmin) {
      info(`warning: ${email} is not an admin here. Check that the server reads the same ADMIN_EMAIL and ADMIN_PASSWORD (restart \`bun run dev\` after editing ${dv.file}).`);
    }
    out({ ok: true, method: "admin (.dev.vars)", email, registered: r.registered, is_admin: isAdmin, tracker: TRACKER_URL, saved_to: TOKENS_FILE });
    return;
  }
  if (flags.email !== undefined) {
    if (flags.email === true) throw usage("usage: login --email ADDR [--register]");
    const email = flags.email;
    const password = await getPassword(flags, `Password for ${email}: `);
    if (!password) throw usage("empty password");
    const r = await emailLogin(email, password, { register: !!flags.register });
    out({ ok: true, method: "email", email, registered: r.registered, is_admin: !!(r.user && r.user.is_admin), tracker: TRACKER_URL, saved_to: TOKENS_FILE });
    return;
  }
  if (flags.token) {
    info("warning: --token sends your GitHub token to the tracker. Prefer the gist-proof `login`.");
    const ghToken = run("gh", ["auth", "token"]);
    if (!ghToken) throw invalid("`gh auth token` printed nothing.");
    const res = await api("/api/auth/token-check", { method: "POST", body: { token: ghToken } });
    if (!res.token) throw invalid("the server returned no tracker token.");
    saveToken(res.token);
    out({ ok: true, method: "token-check", login: res.github_login || res.login || null, tracker: TRACKER_URL, saved_to: TOKENS_FILE });
    return;
  }
  // Gist-proof flow.
  const githubLogin = ghLogin();
  info(`GitHub user: @${githubLogin}`);
  const ch = await api("/api/auth/gh-challenge", { method: "POST", body: { github_login: githubLogin } });
  if (!ch.nonce) throw invalid("the server returned no nonce.");
  info("Creating a secret gist with the nonce...");
  const gistUrl = createGist(`iosonand-login-${ch.nonce}`, `iOSOnAnd tracker login proof\nuser: @${githubLogin}\nnonce: ${ch.nonce}\n`);
  try {
    const v = await api("/api/auth/gh-verify", {
      method: "POST",
      body: { github_login: githubLogin, gist_url: gistUrl, nonce: ch.nonce },
    });
    if (!v.token) throw invalid("the server returned no tracker token.");
    saveToken(v.token);
  } finally {
    deleteGist(gistUrl);
  }
  out({ ok: true, method: "gist-proof", login: githubLogin, tracker: TRACKER_URL, saved_to: TOKENS_FILE });
}

function ghLogin() {
  let me;
  try {
    me = JSON.parse(run("gh", ["api", "user"]));
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw invalid("could not parse `gh api user` output. Run `gh auth login` first.");
  }
  if (!me.login) throw invalid("`gh api user` returned no login.");
  return me.login;
}

/** `gh gist create` makes a secret gist unless --public is given. */
function createGist(desc, body) {
  const o = run("gh", ["gist", "create", "-d", desc, "-f", "iosonand-proof.txt", "-"], { input: body });
  const m = o.match(/https:\/\/gist\.github\.com\/\S+/);
  if (!m) throw invalid(`no gist URL in \`gh gist create\` output: ${o}`);
  return m[0];
}

function deleteGist(url) {
  const r = spawnSync("gh", ["gist", "delete", "--yes", url], { encoding: "utf8" });
  if (r.status === 0) return;
  const r2 = spawnSync("gh", ["gist", "delete", url], { encoding: "utf8" });
  if (r2.status !== 0) info(`warning: could not delete the gist. Delete it by hand: ${url}`);
}

async function cmdLink(flags, positionals) {
  const email = str(flags, "email") || positionals[0];
  if (!email) throw usage("usage: link --email ADDR");
  const password = await getPassword(flags, "Account password: ");
  if (!password) throw usage("empty password");
  const githubLogin = ghLogin();
  const ch = await api("/api/auth/gh-challenge", { method: "POST", body: { github_login: githubLogin } });
  if (!ch.nonce) throw invalid("the server returned no nonce.");
  info(`Proving @${githubLogin} with a secret gist...`);
  const gistUrl = createGist(`iosonand-link-${ch.nonce}`, `iOSOnAnd tracker link proof\nuser: @${githubLogin}\nnonce: ${ch.nonce}\n`);
  let res;
  try {
    res = await api("/api/auth/link", {
      method: "POST",
      body: { email, password, github_login: githubLogin, gist_url: gistUrl, nonce: ch.nonce },
    });
  } finally {
    deleteGist(gistUrl);
  }
  out({ ok: true, method: "link", email, login: githubLogin, server: res });
}

/* ------------------------------------------------------------------ */
/* Offline queue                                                       */
/* ------------------------------------------------------------------ */

const queueFile = () => process.env.TRACKER_QUEUE || path.join(process.cwd(), "TRACKER_QUEUE.md");
const shellQuote = (a) => (/^[A-Za-z0-9_./:@=+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const QUEUE_RE = /^- \[ \] `.*` <!-- argv:(\[.*\]) -->$/;

function cmdQueue(argv) {
  if (!argv.length || !WRITE_COMMANDS.has(argv[0])) {
    throw usage(`usage: queue <write command> [args]. Write commands: ${[...WRITE_COMMANDS].join(", ")}`);
  }
  if (argv.some((a) => a === "--url" || a.startsWith("--url="))) {
    throw usage("do not put --url in a queued command; pass it to `flush` instead");
  }
  if (argv[0] === "status-set") {
    const { positionals } = parseArgs(argv.slice(1));
    if (positionals.length < 3) throw usage("usage: queue status-set <device> <area> <state> --detail ... --source ...");
    checkState(positionals[2]);
  }
  const f = queueFile();
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
    if (text && !text.endsWith("\n")) text += "\n";
  } catch {
    text = "# Tracker queue\n\nWritten by `node cli.mjs queue`. Send with `node cli.mjs flush`.\n\n";
  }
  const line = `- [ ] \`${argv.map(shellQuote).join(" ")}\` <!-- argv:${JSON.stringify(argv)} -->`;
  fs.writeFileSync(f, text + line + "\n");
  out({ ok: true, queued: argv, file: f });
}

function cmdFlush() {
  const f = queueFile();
  let lines;
  try {
    lines = fs.readFileSync(f, "utf8").split("\n");
  } catch {
    out({ ok: true, file: f, sent: 0, note: "no queue file" });
    return;
  }
  const kept = [];
  const results = [];
  let stop = false;
  for (const line of lines) {
    const m = line.match(QUEUE_RE);
    let argv = null;
    if (m) {
      try {
        argv = JSON.parse(m[1]);
      } catch { /* keep the line as is */ }
    }
    if (!argv || stop) {
      kept.push(line);
      continue;
    }
    const r = spawnSync(process.execPath, [SCRIPT, "--url", TRACKER_URL, ...argv], { encoding: "utf8" });
    const ok = r.status === 0;
    const err = (r.stderr || "").trim();
    results.push(ok ? { argv, ok } : { argv, ok, exit: r.status, error: err });
    if (!ok) {
      kept.push(line);
      if (err.includes("cannot reach the tracker")) stop = true;
    }
  }
  fs.writeFileSync(f, kept.join("\n"));
  const failed = results.filter((r) => !r.ok).length;
  out({ ok: failed === 0, file: f, tracker: TRACKER_URL, sent: results.length - failed, failed, results });
  if (failed) process.exitCode = 1;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function cmdStatusSet(positionals, flags) {
  const [device, area, state] = positionals;
  if (!device || !area || !state) throw usage("usage: status-set <device> <area> <state> --detail TEXT --source REF [--os ios|macos|tvos] [--version V] [--photo FILE ...]");
  checkState(state);
  const photos = photosOf(flags);
  const os = str(flags, "os") ? checkOs(flags.os) : undefined;
  const osVersion = str(flags, "version") || str(flags, "os-version") || undefined;
  await checkArea(area);
  const detail = str(flags, "detail");
  const source = str(flags, "source");
  if (!detail) info("warning: no --detail. Say what was observed.");
  if (!source) info("warning: no --source. Cite the doc, log or commit the claim comes from.");
  const res = await api(`/api/status/${encodeURIComponent(device)}/${encodeURIComponent(area)}`, {
    method: "PUT",
    auth: true,
    body: { state, detail, source, ...(os ? { os } : {}), ...(osVersion ? { os_version: osVersion } : {}) },
  });
  // Photos are linked to the change just written (its status_history row).
  const historyId = res?.status?.history_id;
  if (photos.length && !historyId) throw invalid("the server did not return the status change's id; upload with media-upload --area instead");
  const media = photos.length ? await uploadLinked(photos, device, { historyId, caption: detail }) : undefined;
  out({ ok: true, device, area, state, detail, source, ...(os ? { os } : {}), ...(osVersion ? { os_version: osVersion } : {}), ...(media ? { media } : {}), server: res });
}

/* ------------------------------------------------------------------ */
/* references: which ports to start from and borrow parts from         */
/* ------------------------------------------------------------------ */

const GPU_AREAS = ["gpu", "metal", "gles"];
const GPU_ISSUE_KINDS = ["white-widgets", "black-ui", "gpu-fault", "out-of-memory", "artifacts", "slow", "crash", "other"];
const GPU_ISSUE_STATES = ["open", "workaround", "fixed"];
/** The JSON body of a GPU issue from flags; checks kind and state before anything is sent. */
function gpuIssueBody(flags) {
  if (str(flags, "kind") && !GPU_ISSUE_KINDS.includes(flags.kind)) throw invalid(`--kind must be one of: ${GPU_ISSUE_KINDS.join(", ")}`);
  if (str(flags, "state") && !GPU_ISSUE_STATES.includes(flags.state)) throw invalid(`--state must be one of: ${GPU_ISSUE_STATES.join(", ")}`);
  const b = {};
  for (const [k, fl] of [["title", "title"], ["kind", "kind"], ["state", "state"], ["cause", "cause"], ["fix", "fix"], ["detail", "detail"], ["source", "source"], ["os_version", "version"]]) {
    if (typeof flags[fl] === "string") b[k] = flags[fl];
  }
  return b;
}
const GPU_METHODS = ["native-metal", "metal-vulkan", "metal-gl", "gles", "virtio-gpu", "cpu", "other", "unknown"];

function fpsText(a) {
  if (a.fps_low == null && a.fps_high == null) return "";
  return a.fps_low != null && a.fps_high != null && a.fps_high !== a.fps_low ? `${a.fps_low}-${a.fps_high}` : String(a.fps_low ?? a.fps_high);
}

/** Phones by GPU work first (Metal, GL ES, compositing that works), then everything that works. */
function byGpuWork(a, b) {
  const g = (r) => Object.values(r.gpu_areas).filter((x) => x.state === "works").length * 2 + Object.values(r.gpu_areas).filter((x) => x.state === "in-progress").length;
  return g(b) - g(a) || b.works.length - a.works.length;
}

/** One phone as a reference: its chip, GPU, family, what works, and its repos with branch links. */
function referenceOf(d, extra = {}) {
  const repos = new Map();
  for (const f of d.forks || []) repos.set(f.repo, f);
  for (const s of d.supported_by || []) if (!repos.has(s.repo)) repos.set(s.repo, s);
  return {
    slug: d.slug,
    name: d.name,
    chip: d.soc || "",
    model: d.model || "",
    family: d.family || "",
    gpu: d.gpu || "",
    gpu_family: d.gpu_family || "",
    gpu_driver: d.gpu_driver || "",
    // How the acceleration works and how fast, when recorded (gpu-set).
    gpu_accel: d.gpu_accel
      ? {
          method: d.gpu_accel.method,
          how: d.gpu_accel.stack,
          fps: fpsText(d.gpu_accel),
          fps_note: d.gpu_accel.fps_note,
          repos: d.gpu_accel.repos,
          source: d.gpu_accel.source,
        }
      : null,
    // What the GPU does on this phone: GPU compositing, Metal, OpenGL ES (state, detail, source).
    gpu_areas: Object.fromEntries(
      (d.statuses || [])
        .filter((s) => GPU_AREAS.includes(s.area_slug) && s.state !== "unknown")
        .map((s) => [s.area_slug, { state: s.state, detail: s.detail || "", source: s.source || "" }]),
    ),
    // Porting records of its repos (UniXNU's device records): per repo, how many areas are verified on the device.
    porting: (d.porting || []).slice(0, 5).map((p) => ({
      record: p.record,
      repo: p.repo,
      os: p.os_profile,
      device_verified: p.counts.device_verified,
      implemented: p.counts.implemented,
      gpu: p.area_status.gpu || "",
      network: p.area_status.network || "",
    })),
    ios: d.ios_version || "",
    works: (d.statuses || []).filter((s) => s.state === "works").map((s) => s.area_slug),
    in_progress: (d.statuses || []).filter((s) => s.state === "in-progress").map((s) => s.area_slug),
    repos: [...repos.values()].map((f) => {
      const branch = String(f.branch || "").split(/[\s,]+/).filter(Boolean)[0] || "";
      return {
        repo: f.repo,
        branch,
        url: `https://github.com/${f.repo}${branch ? `/tree/${branch}` : ""}`,
        project: f.base_project || "",
        ...(f.support ? { support: f.support } : {}),
      };
    }),
    page: `${TRACKER_URL}/device/${d.slug}`,
    ...extra,
  };
}

/** Chip search words: "Snapdragon 778G (SM7325)" -> ["SM7325", "Snapdragon 778G"]. */
function chipTerms(chip) {
  const out = [];
  const paren = /\(([^)]+)\)/.exec(chip);
  if (paren) out.push(paren[1].trim());
  const bare = chip.replace(/\([^)]*\)/g, "").trim();
  if (bare) out.push(bare);
  return [...new Set(out)];
}

/**
 * references [--chip TEXT] [--gpu TEXT] [--device SLUG] [--area AREA] [--limit N]:
 * the tracker as a map for porting. --chip: phones on that chip (search by
 * name or part number), with their repos, branches and what works. --gpu:
 * phones on that GPU or GPU family, GPU work (metal, gles, gpu) first.
 * --device: that phone plus the phones on its chip and its GPU family.
 * --area: where that area works (gpu, wifi, audio ...), with the repo and
 * branch to read and the source. Every phone carries its GPU, GPU family,
 * the open driver to read, and its gpu_areas.
 */
async function cmdReferences(flags) {
  const limit = Number(str(flags, "limit")) || 25;
  const result = { tracker: TRACKER_URL };
  let chip = str(flags, "chip");
  if (str(flags, "device")) {
    const d = (await api(`/api/devices/${encodeURIComponent(flags.device)}`)).device;
    result.device = referenceOf(d);
    chip = chip || d.soc || "";
  }
  if (chip) {
    const seen = new Map();
    for (const term of chipTerms(chip)) {
      const r = await api(`/api/devices?q=${encodeURIComponent(term)}&limit=50`);
      for (const d of r.devices || []) if (!seen.has(d.slug) && d.slug !== result.device?.slug) seen.set(d.slug, d);
    }
    result.chip = chip;
    result.same_chip = [...seen.values()]
      .map((d) => referenceOf(d))
      .sort((a, b) => b.works.length - a.works.length)
      .slice(0, limit);
  }
  // The same GPU (exact model first, then the family: "Adreno 6xx", "Mali Valhall (JM)" ...).
  const gpuQuery = str(flags, "gpu");
  const sameGpu = async (q, exact) => {
    const r = await api(`/api/devices?gpu=${encodeURIComponent(q)}&limit=500`);
    return (r.devices || [])
      .filter((d) => d.slug !== result.device?.slug)
      .map((d) => referenceOf(d))
      .sort((a, b) => (exact ? (b.gpu === exact) - (a.gpu === exact) : 0) || byGpuWork(a, b))
      .slice(0, limit);
  };
  if (gpuQuery) {
    result.gpu = gpuQuery;
    result.same_gpu = await sameGpu(gpuQuery, "");
  } else if (result.device?.gpu_family) {
    // With --device: the phones on the same GPU family, exact GPU first.
    result.same_gpu = await sameGpu(result.device.gpu_family, result.device.gpu);
  }
  if (str(flags, "area")) {
    const area = flags.area;
    await checkArea(area);
    const st = await api(`/api/status?area=${encodeURIComponent(area)}&state=works`);
    const slugs = new Set((st.statuses || []).map((s) => s.device_slug));
    const all = (await api("/api/devices?limit=500")).devices || [];
    result.area = area;
    result.works_on = all
      .filter((d) => slugs.has(d.slug))
      .map((d) => {
        const row = (st.statuses || []).find((s) => s.device_slug === d.slug) || {};
        return referenceOf(d, { detail: row.detail || "", source: row.source || "" });
      })
      .sort((a, b) => b.works.length - a.works.length)
      .slice(0, limit);
  }
  if (!result.device && !result.same_chip && !result.works_on && !result.same_gpu) {
    throw usage('usage: references [--chip "Snapdragon 778G"] [--gpu "Adreno 619" | "Adreno 6xx" | "Mali Valhall"] [--device SLUG] [--area metal|gles|gpu|wifi...] [--limit N]');
  }
  out(result);
}

async function cmdCheck() {
  const results = {};
  let unreachable = null;
  const step = async (name, fn) => {
    if (unreachable) {
      results[name] = { ok: false, detail: "skipped: tracker unreachable" };
      return;
    }
    try {
      results[name] = { ok: true, detail: await fn() };
    } catch (e) {
      if (e.unreachable) unreachable = e;
      results[name] = { ok: false, detail: String(e.message || e) };
    }
  };
  await step("docs", async () => {
    const r = await api("/api/docs");
    const list = Array.isArray(r) ? r : r.endpoints || r.routes;
    return Array.isArray(list) ? `${list.length} endpoints` : "ok";
  });
  await step("areas_seed", async () => {
    const n = ((await api("/api/areas")).areas || []).length;
    if (n < 24) throw invalid(`expected >= 24 seeded areas, got ${n}. Seed with \`bun run seed:local\`.`);
    return `${n} areas`;
  });
  await step("devices", async () => {
    const n = ((await api("/api/devices?limit=100")).devices || []).length;
    if (!n) throw invalid("no devices. Seed with `bun run seed:local`.");
    return `${n} devices`;
  });
  await step("login", async () => {
    if (!tokenSource().token) return "not logged in (reads work; writes need `login`)";
    const u = (await api("/api/auth/me", { auth: true })).user || {};
    return `logged in as ${u.github_login ? "@" + u.github_login : u.email || u.display_name || "user#" + u.id}`;
  });
  const allOk = Object.values(results).every((r) => r.ok);
  out({ tracker: TRACKER_URL, url_from: URL_FROM, ok: allOk, checks: results });
  if (unreachable) info(`error: ${unreachable.message}`);
  if (!allOk) process.exitCode = 1;
}

/** The fork row of OWNER/REPO (or a github.com URL), from GET /api/forks. */
async function forkOf(repoArg) {
  if (!repoArg) throw usage("give the repo as OWNER/REPO");
  const repo = repoArg.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  for (let offset = 0; ; ) {
    const r = await api(`/api/forks?limit=500&offset=${offset}`);
    const hit = (r.forks || []).find((x) => x.repo.toLowerCase() === repo.toLowerCase());
    if (hit) return hit;
    if (r.next == null) break;
    offset = r.next;
  }
  throw invalid(`${repo} is not tracked on ${TRACKER_URL}. Add it with: node ./cli.mjs repo-add ${repo} --device <slug>`);
}

async function cmdRepoClaim(cmd, positionals, flags) {
  const repo = positionals[0] || str(flags, "repo");
  if (!repo) throw usage(`usage: ${cmd} OWNER/REPO${cmd === "repo-add" ? " --device SLUG [--branch B] [--best-result T]" : " [--device SLUG] [--note TEXT]"}`);
  if (cmd === "repo-add" && !str(flags, "device") && !str(flags, "new-device")) {
    throw usage('usage: repo-add OWNER/REPO (--device SLUG | --new-device "Phone name" [--model CODENAME] [--soc CHIP]) [--branch B] [--best-result T]');
  }
  const b = { repo, device: str(flags, "device") || undefined, note: str(flags, "note") };
  // A phone the tracker does not list (find its name with `catalog`); only with your own repo.
  if (str(flags, "new-device") && !b.device) {
    b.new_device = { name: flags["new-device"], ...(str(flags, "model") ? { model: flags.model } : {}), ...(str(flags, "soc") ? { soc: flags.soc } : {}) };
  }
  if (str(flags, "branch")) b.branch = flags.branch;
  if (str(flags, "best-result")) b.best_result = flags["best-result"];
  const { res, data } = await api("/api/repos/claim", { method: "POST", auth: true, body: b, raw: true });
  if (!res.ok) {
    throw new CliError(`POST ${TRACKER_URL}/api/repos/claim -> ${res.status} ${data.error || "error"}${data.hint ? `\n  hint: ${data.hint}` : ""}`, 1, { status: res.status });
  }
  const c = data.claim || {};
  if (res.status === 202 && c.nonce) {
    info(
      `Claim #${c.id} is pending (until ${c.expires}). To prove you can push to ${c.repo}:\n` +
        `  printf '%s\\n' '${c.nonce}' > .iosonand-verify && git add .iosonand-verify && git commit -m "iOSOnAnd verification" && git push\n` +
        `  node ./cli.mjs repo-verify ${c.id}\n` +
        `then delete .iosonand-verify again.`,
    );
  } else if (res.status === 202 && c.method === "review") {
    info(`Claim #${c.id} is pending: a maintainer of ${c.repo} (or an admin) approves it with repo-claim-approve ${c.id}; then you join its maintainers.`);
  } else if (data.already) {
    info(`You already maintain ${data.fork?.repo}.`);
  } else if (c.status === "approved") {
    info(`Approved (${c.method}): you maintain ${data.fork?.repo}${data.fork?.device_slug ? ` and ${data.fork.device_slug}` : ""}.`);
  }
  if (cmd === "repo-add" && data.fork && !data.already && data.fork.device_slug && data.fork.device_slug !== b.device) {
    info(`note: ${data.fork.repo} was already tracked for ${data.fork.device_slug}; --branch/--best-result were not applied. Use fork-sync after the claim.`);
  }
  out({ status: res.status, ...data });
}

async function cmdMediaUpload(positionals, flags) {
  const file = positionals[0];
  const device = str(flags, "device");
  if (!file || !device) throw usage("usage: media-upload <file> --device SLUG [--area A] [--history ID] [--feature ID] [--fork-id N] [--caption T]");
  const media = await uploadFile(file, device, {
    area: str(flags, "area"),
    forkId: str(flags, "fork-id"),
    caption: str(flags, "caption"),
    historyId: str(flags, "history"),
    featureId: str(flags, "feature"),
  });
  out({ ok: true, media: { ...media, url: TRACKER_URL + media.url } });
}

/** POST /api/media for one file; returns the media row. */
async function uploadFile(file, device, { area = "", forkId = "", caption = "", historyId = "", featureId = "" } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw invalid(`no such file: ${file}`);
  }
  if (!st.isFile()) throw invalid(`not a file: ${file}`);
  if (st.size > 95 * 1024 * 1024) throw invalid(`${file} is ${Math.round(st.size / 1048576)} MB; the limit is 95 MB for videos and 15 MB for images`);
  // Node 19.8+ streams the file (fs.openAsBlob); Node 18 reads it into memory.
  const blob = typeof fs.openAsBlob === "function" ? await fs.openAsBlob(file) : new Blob([fs.readFileSync(file)]);
  const form = new FormData();
  // The text fields go first: the server checks them before it stores the file.
  form.append("device", device);
  if (area) form.append("area", area);
  if (forkId) form.append("fork_id", forkId);
  if (historyId) form.append("history_id", String(historyId));
  if (featureId) form.append("feature_id", String(featureId));
  if (caption) form.append("caption", caption.slice(0, 500));
  form.append("file", blob, path.basename(file));
  const r = await api("/api/media", { method: "POST", auth: true, form });
  return r.media;
}

/**
 * update <device> [file ...] --text "..." [--area A]: a photo update in one
 * go. Each file is uploaded (captioned with the text), then they are posted
 * together as one update on the phone.
 */
async function cmdUpdate(positionals, flags) {
  const [device, ...files] = positionals;
  files.push(...photosOf(flags));
  const text = str(flags, "text") || str(flags, "body");
  if (!device || (!text && !files.length)) {
    throw usage('usage: update <device> [photo-or-clip ...] --text "what changed" [--area A]');
  }
  if (files.length > 10) throw usage("at most 10 files per update");
  const media = [];
  for (const f of files) {
    info(`uploading ${f}...`);
    media.push(await uploadFile(f, device, { area: str(flags, "area"), caption: text }));
  }
  const r = await api(`/api/devices/${encodeURIComponent(device)}/updates`, {
    method: "POST",
    auth: true,
    body: { body: text, media_ids: media.map((m) => m.id) },
  });
  const u = r.update;
  out({ ok: true, update: { ...u, media: (u.media || []).map((m) => ({ ...m, url: TRACKER_URL + m.url })) }, page: `${TRACKER_URL}/device/${device}` });
}

/** catalog <words>: search every Android phone and tablet (Google Play's list). */
async function cmdCatalog(positionals, flags) {
  const q = positionals.join(" ").trim();
  if (q.length < 2) throw usage('usage: catalog <name, codename or model> [--limit N], e.g. catalog redmi note 7');
  const r = await api(`/api/catalog?q=${encodeURIComponent(q)}${str(flags, "limit") ? `&limit=${encodeURIComponent(flags.limit)}` : ""}`);
  const rows = (r.catalog || []).map((c) => ({
    name: c.display,
    codenames: c.codenames,
    models: c.models.slice(0, 5),
    tracked: c.tracked,
    add: c.tracked
      ? `node cli.mjs repo-add OWNER/REPO --device ${c.tracked}`
      : `node cli.mjs repo-add OWNER/REPO --new-device "${c.display}"${c.codenames[0] ? ` --model ${c.codenames[0]}` : ""}`,
  }));
  out({ query: q, catalog: rows });
}

function body(flags, map) {
  const o = {};
  for (const [key, flag] of Object.entries(map)) o[key] = str(flags, flag);
  return o;
}

async function main() {
  let argv = process.argv.slice(2);
  // Global --url, anywhere on the line.
  const ui = argv.findIndex((a) => a === "--url" || a.startsWith("--url="));
  if (ui !== -1) {
    const a = argv[ui];
    const inline = a.includes("=");
    const v = inline ? a.slice(a.indexOf("=") + 1) : argv[ui + 1];
    if (!v || v.startsWith("--")) throw usage("--url needs a value, e.g. --url http://127.0.0.1:3000");
    TRACKER_URL = v;
    URL_FROM = "--url";
    argv = argv.filter((_, i) => i !== ui && (inline || i !== ui + 1));
  } else if (process.env.TRACKER_URL) {
    TRACKER_URL = process.env.TRACKER_URL;
    URL_FROM = "TRACKER_URL";
  }
  // Global --token ion_... (login --token, a boolean, is left alone).
  const ti = argv.findIndex((a, i) => (a === "--token" && /^ion_/.test(argv[i + 1] || "")) || a.startsWith("--token="));
  if (ti !== -1) {
    const a = argv[ti];
    const inline = a.includes("=");
    TOKEN_FLAG = (inline ? a.slice(a.indexOf("=") + 1) : argv[ti + 1]).trim();
    if (!TOKEN_FLAG) throw usage("--token needs a value: --token ion_...");
    argv = argv.filter((_, i) => i !== ti && (inline || i !== ti + 1));
  }
  TRACKER_URL = TRACKER_URL.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(TRACKER_URL)) throw usage(`the tracker URL must start with http:// or https://, got ${TRACKER_URL}`);

  if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0])) {
    console.log(help());
    return;
  }
  const [cmd, ...rest] = argv;
  if (cmd === "queue") return cmdQueue(rest);
  const { positionals, flags } = parseArgs(rest);
  if (flags.help) {
    console.log(help());
    return;
  }

  switch (cmd) {
    case "login":
      return cmdLogin(flags);
    case "link":
      return cmdLink(flags, positionals);
    case "logout": {
      const removed = removeToken();
      out({ ok: true, tracker: TRACKER_URL, removed, note: removed ? undefined : "no stored token for this tracker" });
      return;
    }
    case "whoami": {
      const src = tokenSource();
      const r = await api("/api/auth/me", { auth: true });
      const u = r.user || {};
      const maintains = r.maintains ?? u.maintains;
      out({
        tracker: TRACKER_URL,
        token_from: src.from,
        id: u.id,
        login: u.github_login || null,
        email: u.email || null,
        display_name: u.display_name || null,
        is_admin: !!u.is_admin,
        maintains: maintains ?? null,
        maintains_repos: r.maintains_repos ?? u.maintains_repos ?? [],
        ...(r.token_scopes ? { token_scopes: r.token_scopes } : {}),
        ...(maintains === undefined ? { note: "this server does not report maintains yet" } : {}),
      });
      return;
    }
    case "tokens": {
      const src = tokenSource();
      const masked = src.token ? `${src.token.slice(0, 6)}...${src.token.slice(-4)}` : null;
      let validity = null;
      if (src.token && !flags["no-check"]) {
        try {
          const r = await api("/api/auth/token-check", { method: "POST", body: { token: src.token } });
          validity = { ok: true, login: r.github_login || r.login || r.email || null };
        } catch (e) {
          if (e.unreachable) throw e;
          validity = { ok: false, error: e.message };
        }
      }
      out({ tracker: TRACKER_URL, source: src.from, masked, validity });
      return;
    }
    case "areas": {
      const r = await api("/api/areas");
      out(r.areas || r);
      return;
    }
    case "status-get": {
      const q = new URLSearchParams();
      if (str(flags, "device")) q.set("device", flags.device);
      if (str(flags, "area")) q.set("area", flags.area);
      if (str(flags, "state")) {
        checkState(flags.state);
        q.set("state", flags.state);
      }
      if (str(flags, "os")) q.set("os", checkOs(flags.os, true));
      out(await api(`/api/status${q.toString() ? `?${q}` : ""}`));
      return;
    }
    case "features": {
      const device = positionals[0] || str(flags, "device");
      if (!device) throw usage("usage: features <device>");
      out(await api(`/api/devices/${encodeURIComponent(device)}/features`));
      return;
    }
    case "feature-add": {
      const [device, name, state] = positionals;
      if (!device || !name) throw usage('usage: feature-add <device> "<name>" [<state>] --detail TEXT --source REF [--os ios|macos|tvos] [--photo FILE ...]');
      if (state) checkState(state);
      const photos = photosOf(flags);
      if (!str(flags, "detail")) info("warning: no --detail. Say what was observed.");
      if (!str(flags, "source")) info("warning: no --source. Cite the log, commit or video it comes from.");
      const body = { name, ...(state ? { state } : {}), detail: str(flags, "detail"), source: str(flags, "source"), ...(str(flags, "os") ? { os: checkOs(flags.os) } : {}) };
      const r = await api(`/api/devices/${encodeURIComponent(device)}/features`, { method: "POST", auth: true, body });
      const media = photos.length ? await uploadLinked(photos, device, { featureId: r.feature.id, caption: str(flags, "detail") || name }) : undefined;
      out(media ? { ...r, media } : r);
      return;
    }
    case "feature-set": {
      const [device, id] = positionals;
      if (!device || !id) throw usage("usage: feature-set <device> <id> [--state S] [--name N] [--detail T] [--source R] [--os OS] [--photo FILE ...]");
      const photos = photosOf(flags);
      const body = {};
      if (str(flags, "state")) body.state = (checkState(flags.state), flags.state);
      for (const k of ["name", "detail", "source"]) if (flags[k] !== undefined) body[k] = str(flags, k);
      if (str(flags, "os")) body.os = checkOs(flags.os);
      const r = Object.keys(body).length
        ? await api(`/api/devices/${encodeURIComponent(device)}/features/${encodeURIComponent(id)}`, { method: "PATCH", auth: true, body })
        : null;
      if (!r && !photos.length) throw usage("feature-set: nothing to change (--state, --name, --detail, --source, --os or --photo)");
      const media = photos.length ? await uploadLinked(photos, device, { featureId: id, caption: str(flags, "detail") }) : undefined;
      out({ ...(r ?? { ok: true }), ...(media ? { media } : {}) });
      return;
    }
    case "porting": {
      const q = new URLSearchParams();
      if (positionals[0]) q.set("device", positionals[0]);
      for (const k of ["device", "repo", "codename", "component", "framework", "area", "status", "limit", "offset"]) if (str(flags, k)) q.set(k, flags[k]);
      if (![...q.keys()].length) throw usage("usage: porting [<device>] [--repo R] [--codename C] [--component Adreno740] [--area gpu --status device-verified] [--framework UniXNU]");
      out(await api(`/api/porting?${q}`));
      return;
    }
    case "porting-get": {
      const key = positionals[0];
      if (!key) throw usage("usage: porting-get <record>   (e.g. uke-nsr-xine or unixnu:uke-nsr-xine; keys from porting)");
      out(await api(`/api/porting/${encodeURIComponent(key)}`));
      return;
    }
    case "components": {
      const q = new URLSearchParams();
      if (positionals.length) q.set("q", positionals.join(" "));
      if (str(flags, "framework")) q.set("framework", flags.framework);
      out(await api(`/api/porting/components${q.toString() ? `?${q}` : ""}`));
      return;
    }
    case "gpu-issues": {
      const q = new URLSearchParams();
      if (positionals[0]) q.set("device", positionals[0]);
      for (const k of ["kind", "state", "q"]) if (str(flags, k)) q.set(k, flags[k]);
      out(await api(`/api/gpu/issues${q.toString() ? `?${q}` : ""}`));
      return;
    }
    case "gpu-issue-add": {
      const device = positionals[0];
      const title = positionals[1] || str(flags, "title");
      if (!device || !title) {
        throw usage('usage: gpu-issue-add <device> "<symptom>" --kind white-widgets|black-ui|gpu-fault|out-of-memory|artifacts|slow|crash|other [--state open|workaround|fixed] --cause "..." [--fix "..."] --source REF [--version V]');
      }
      const b = { ...gpuIssueBody(flags), title };
      if (!b.source) info("warning: no --source. Cite the log, commit or video that shows it.");
      out(await api(`/api/devices/${encodeURIComponent(device)}/gpu/issues`, { method: "POST", auth: true, body: b }));
      return;
    }
    case "gpu-issue-set": {
      const [device, id] = positionals;
      if (!device || !id) throw usage('usage: gpu-issue-set <device> <id> [--state fixed --fix "..."] [--kind K] [--title T] [--cause T] [--detail T] [--source R] [--version V]');
      const b = gpuIssueBody(flags);
      if (!Object.keys(b).length) throw usage("gpu-issue-set: give at least one field, e.g. --state fixed --fix \"...\"");
      out(await api(`/api/devices/${encodeURIComponent(device)}/gpu/issues/${encodeURIComponent(id)}`, { method: "PATCH", auth: true, body: b }));
      return;
    }
    case "gpu-issue-remove": {
      const [device, id] = positionals;
      if (!device || !id) throw usage("usage: gpu-issue-remove <device> <id>");
      out(await api(`/api/devices/${encodeURIComponent(device)}/gpu/issues/${encodeURIComponent(id)}`, { method: "DELETE", auth: true }));
      return;
    }
    case "gpu-get": {
      const device = positionals[0] || str(flags, "device");
      if (!device) throw usage("usage: gpu-get <device>");
      out(await api(`/api/devices/${encodeURIComponent(device)}/gpu`));
      return;
    }
    case "gpu-set": {
      const device = positionals[0];
      if (!device) {
        throw usage('usage: gpu-set <device> --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu|other --stack "A -> B -> C" --fps 40-58 --fps-note "idle lock screen" [--repos OWNER/REPO,...] --detail T --source REF [--version V]');
      }
      if (str(flags, "method") && !GPU_METHODS.includes(flags.method)) throw invalid(`--method must be one of: ${GPU_METHODS.join(", ")}`);
      const b = {};
      for (const [k, fl] of [["method", "method"], ["stack", "stack"], ["fps", "fps"], ["fps_note", "fps-note"], ["detail", "detail"], ["source", "source"], ["os_version", "version"]]) {
        if (typeof flags[fl] === "string") b[k] = flags[fl];
      }
      if (typeof flags.repos === "string") b.repos = flags.repos.split(",").map((s) => s.trim()).filter(Boolean);
      if (!Object.keys(b).length) throw usage("gpu-set: give at least --method (and --stack, --fps, --fps-note, --repos, --detail, --source)");
      if (!b.source && !str(flags, "source")) info("warning: no --source. Cite the log, commit or video the method and frame rate come from.");
      out(await api(`/api/devices/${encodeURIComponent(device)}/gpu`, { method: "PUT", auth: true, body: b }));
      return;
    }
    case "feature-remove": {
      const [device, id] = positionals;
      if (!device || !id) throw usage("usage: feature-remove <device> <id>");
      out(await api(`/api/devices/${encodeURIComponent(device)}/features/${encodeURIComponent(id)}`, { method: "DELETE", auth: true }));
      return;
    }
    case "history": {
      const device = positionals[0] || str(flags, "device");
      if (!device) throw usage("usage: history <device> [--limit N] [--os ios|macos|tvos|all]");
      const q = new URLSearchParams({ limit: String(Number(str(flags, "limit")) || 30) });
      if (str(flags, "os")) q.set("os", checkOs(flags.os, true));
      out(await api(`/api/devices/${encodeURIComponent(device)}/history?${q}`));
      return;
    }
    case "status-set":
      return cmdStatusSet(positionals, flags);
    case "device-add": {
      const slug = positionals[0] || str(flags, "slug");
      if (!slug) throw usage("usage: device-add <slug> [--name N] [--model M] [--soc S] ...");
      if (str(flags, "status")) checkState(flags.status);
      const b = body(flags, { name: "name", model: "model", soc: "soc", repo_kind: "repo-kind", status: "status", best_result: "best-result", notes: "notes" });
      out(await api("/api/devices", { method: "POST", auth: true, body: { ...b, slug, name: b.name || slug, repo_kind: b.repo_kind || "fork", status: b.status || "unknown" } }));
      return;
    }
    case "fork-add": {
      const repo = str(flags, "repo") || positionals[0];
      if (!repo) throw usage("usage: fork-add --repo OWNER/REPO [--device SLUG] ...");
      const b = body(flags, { device_slug: "device", branch: "branch", url: "fork-url", best_result: "best-result", ported: "ported", fork_only: "fork-only", notes: "notes" });
      if (!b.url) b.url = repo.includes("/") ? `https://github.com/${repo}` : repo;
      out(await api("/api/forks", { method: "POST", auth: true, body: { repo, ...b } }));
      return;
    }
    case "fork-sync": {
      const repo = str(flags, "repo") || positionals[0];
      if (!repo) throw usage("usage: fork-sync --repo OWNER/REPO [--device SLUG] --best-result TEXT");
      const b = body(flags, { device_slug: "device", best_result: "best-result", ported: "ported", fork_only: "fork-only", notes: "notes" });
      out(await api("/api/forks/sync", { method: "POST", auth: true, body: { repo, ...b } }));
      return;
    }
    case "fork-list": {
      const q = str(flags, "device") ? `?device=${encodeURIComponent(flags.device)}` : "";
      out(await api(`/api/forks${q}`));
      return;
    }
    case "post-add": {
      const title = str(flags, "title");
      const link = str(flags, "link");
      if (!title || !link) throw usage("usage: post-add --title TEXT --link URL [--published DATE] [--note TEXT]");
      if (!/^https?:\/\//.test(link)) throw invalid(`--link must start with http(s)://, got ${link}`);
      const pb = { title, url: link, published: str(flags, "published"), note: str(flags, "note") };
      if (str(flags, "image-url")) pb.image_url = flags["image-url"];
      if (str(flags, "image-width")) pb.image_width = Number(flags["image-width"]);
      if (str(flags, "image-height")) pb.image_height = Number(flags["image-height"]);
      out(await api("/api/posts", { method: "POST", auth: true, body: pb }));
      return;
    }
    case "post-set": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage("usage: post-set <id> [--image-url URL] [--image-width N] [--image-height N] [--title T] [--note T]  (admin)");
      const map = { image_url: "image-url", image_width: "image-width", image_height: "image-height", title: "title", note: "note", published: "published" };
      const b = {};
      for (const [k, fl] of Object.entries(map)) if (typeof flags[fl] === "string") b[k] = /^image_(width|height)$/.test(k) ? (flags[fl] === "" ? null : Number(flags[fl])) : flags[fl];
      if (!Object.keys(b).length) throw usage("post-set: give at least one field, e.g. --image-url https://i.redd.it/....jpg");
      out(await api(`/api/posts/${id}`, { method: "PATCH", auth: true, body: b }));
      return;
    }
    case "post-list": {
      const q = str(flags, "limit") ? `?limit=${encodeURIComponent(flags.limit)}` : "";
      out(await api(`/api/posts${q}`));
      return;
    }
    case "reddit-fetch": {
      const sub = positionals[0] || str(flags, "subreddit") || "hackios";
      out(await api("/api/reddit/fetch", { method: "POST", auth: true, body: { subreddit: sub } }));
      return;
    }
    case "claim-add": {
      const device = positionals[0] || str(flags, "device");
      if (!device) throw usage("usage: claim-add <device> [--note TEXT]");
      out(await api("/api/claims", { method: "POST", auth: true, body: { device, device_slug: device, note: str(flags, "note") } }));
      return;
    }
    case "claim-list": {
      const q = new URLSearchParams();
      if (str(flags, "device")) q.set("device", flags.device);
      if (str(flags, "status")) {
        if (!CLAIM_STATUSES.includes(flags.status)) throw invalid(`--status must be one of: ${CLAIM_STATUSES.join(" | ")}`);
        q.set("status", flags.status);
      }
      out(await api(`/api/claims${q.toString() ? `?${q}` : ""}`));
      return;
    }
    case "claim-approve":
    case "claim-reject": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage(`usage: ${cmd} <id>  (ids from claim-list)`);
      out(await api(`/api/claims/${id}/${cmd === "claim-approve" ? "approve" : "reject"}`, { method: "POST", auth: true }));
      return;
    }
    case "user-add": {
      const email = positionals[0] || str(flags, "email");
      if (!email) throw usage("usage: user-add <email> [--admin]");
      const password = await getPassword(flags, `Password for ${email}: `);
      if (!password) throw usage("empty password");
      out(await api("/api/users", { method: "POST", auth: true, body: { email, password, is_admin: flags.admin ? 1 : 0 } }));
      return;
    }
    case "repo-claim":
    case "repo-add":
      return cmdRepoClaim(cmd, positionals, flags);
    case "repo-verify": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage("usage: repo-verify <claim id>  (the id repo-claim printed)");
      const r = await api(`/api/repos/claim/${id}/verify`, { method: "POST", auth: true });
      info(`verified: you maintain ${r.fork?.repo}${r.fork?.device_slug ? ` and ${r.fork.device_slug}` : ""}. Delete .iosonand-verify from the repo now.`);
      out(r);
      return;
    }
    case "repo-claims": {
      const q = new URLSearchParams();
      if (str(flags, "status")) q.set("status", flags.status);
      if (str(flags, "repo")) q.set("repo", flags.repo);
      out(await api(`/api/repos/claims${q.toString() ? `?${q}` : ""}`, { auth: true }));
      return;
    }
    case "repo-claim-approve":
    case "repo-claim-reject": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage(`usage: ${cmd} <id>  (ids from repo-claims)`);
      out(await api(`/api/repos/claims/${id}/${cmd.endsWith("approve") ? "approve" : "reject"}`, { method: "POST", auth: true }));
      return;
    }
    case "repo-unmaintain": {
      const fork = await forkOf(positionals[0]);
      out(await api(`/api/forks/${fork.id}/maintainer`, { method: "DELETE", auth: true }));
      return;
    }
    case "repo-maintainers": {
      const fork = await forkOf(positionals[0]);
      out({ repo: fork.repo, ...(await api(`/api/forks/${fork.id}/maintainers`)) });
      return;
    }
    case "repo-maintainer-add":
    case "repo-maintainer-remove": {
      const login = (str(flags, "github") || positionals[1] || "").replace(/^@/, "");
      if (!positionals[0] || !login) throw usage(`usage: ${cmd} OWNER/REPO --github LOGIN`);
      const fork = await forkOf(positionals[0]);
      out(
        cmd === "repo-maintainer-add"
          ? await api(`/api/forks/${fork.id}/maintainers`, { method: "POST", auth: true, body: { github_login: login } })
          : await api(`/api/forks/${fork.id}/maintainers?github_login=${encodeURIComponent(login)}`, { method: "DELETE", auth: true }),
      );
      return;
    }
    case "repo-support": {
      const [repo, device] = positionals;
      const support = str(flags, "support");
      if (!repo || !device || !support) throw usage("usage: repo-support OWNER/REPO <device> --support merged|ported|claimed|primary [--via OWNER/REPO] [--note T]");
      if (!SUPPORT_LEVELS.includes(support)) throw invalid(`--support must be one of: ${SUPPORT_LEVELS.join(" | ")}`);
      const fork = await forkOf(repo);
      out(await api(`/api/forks/${fork.id}/devices`, { method: "POST", auth: true, body: { device_slug: device, support, via: str(flags, "via"), note: str(flags, "note") } }));
      return;
    }
    case "repo-lineage": {
      const repo = positionals[0];
      const base = str(flags, "base");
      const relation = str(flags, "relation") || "derived-from";
      if (!repo || !base) throw usage("usage: repo-lineage OWNER/REPO --base X --relation fork-of|derived-from|ported-from|uses [--note T] [--source URL] [--base-project NAME]");
      if (!RELATIONS.includes(relation)) throw invalid(`--relation must be one of: ${RELATIONS.join(" | ")}`);
      const fork = await forkOf(repo);
      const b = { base, relation, note: str(flags, "note"), source: str(flags, "source") };
      if (str(flags, "base-project")) b.base_project = flags["base-project"];
      out(await api(`/api/forks/${fork.id}/lineage`, { method: "POST", auth: true, body: b }));
      return;
    }
    case "lineage":
      out(await api("/api/lineage"));
      return;
    case "keys":
      out(await api("/api/tokens", { auth: true }));
      return;
    case "keys-create": {
      const scopes = (str(flags, "scopes") || "all").split(",").map((x) => x.trim()).filter(Boolean);
      const bad = scopes.filter((x) => !SCOPES.includes(x));
      if (bad.length) throw invalid(`unknown scope ${bad.join(", ")}. Scopes: ${SCOPES.join(" | ")}`);
      let expires = null;
      if (flags["expires-days"] !== undefined) {
        expires = Number(flags["expires-days"]);
        if (![30, 90, 365].includes(expires)) throw invalid("--expires-days must be 30, 90 or 365 (leave it out: never)");
      }
      const r = await api("/api/tokens", { method: "POST", auth: true, body: { name: str(flags, "name") || "cli key", scopes, expires_in_days: expires } });
      info("Store the token now; it is never shown again. Use it with TRACKER_TOKEN=<token> node cli.mjs ...");
      out({ token: r.token, meta: r.meta });
      return;
    }
    case "keys-revoke":
    case "keys-rotate": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage(`usage: ${cmd} <id>  (ids from keys)`);
      if (cmd === "keys-revoke") out(await api(`/api/tokens/${id}`, { method: "DELETE", auth: true }));
      else {
        const r = await api(`/api/tokens/${id}/rotate`, { method: "POST", auth: true });
        info("The old key no longer works. Store the new token now; it is never shown again.");
        out({ token: r.token, meta: r.meta });
      }
      return;
    }
    case "media-upload":
      return cmdMediaUpload(positionals, flags);
    case "update":
      return cmdUpdate(positionals, flags);
    case "updates": {
      const device = positionals[0];
      if (!device) throw usage("usage: updates <device> [--limit N]");
      const r = await api(`/api/devices/${encodeURIComponent(device)}/updates${str(flags, "limit") ? `?limit=${encodeURIComponent(flags.limit)}` : ""}`);
      out({ ...r, updates: (r.updates || []).map((u) => ({ ...u, media: u.media.map((m) => ({ ...m, url: TRACKER_URL + m.url })) })) });
      return;
    }
    case "catalog":
      return cmdCatalog(positionals, flags);
    case "references":
      return cmdReferences(flags);
    case "media-list": {
      const q = new URLSearchParams();
      for (const [k, fl] of [["device", "device"], ["area", "area"], ["fork_id", "fork-id"], ["history_id", "history"], ["feature_id", "feature"], ["limit", "limit"], ["offset", "offset"]]) {
        if (str(flags, fl)) q.set(k, flags[fl]);
      }
      const r = await api(`/api/media${q.toString() ? `?${q}` : ""}`);
      out({ ...r, media: (r.media || []).map((m) => ({ ...m, url: TRACKER_URL + m.url })) });
      return;
    }
    case "media-link": {
      const id = positionals[0];
      const b = {};
      for (const [k, fl] of [["history_id", "history"], ["feature_id", "feature"]]) {
        if (flags[fl] === undefined) continue;
        const v = str(flags, fl);
        if (v === "none") b[k] = null;
        else if (/^\d+$/.test(v)) b[k] = Number(v);
        else throw usage(`--${fl} takes an id, or none to unlink`);
      }
      if (flags.caption !== undefined) b.caption = str(flags, "caption");
      if (!id || !/^\d+$/.test(id) || !Object.keys(b).length) {
        throw usage("usage: media-link <media id> [--history ID|none] [--feature ID|none] [--caption T]  (ids: media-list, history, features)");
      }
      const r = await api(`/api/media/${id}`, { method: "PATCH", auth: true, body: b });
      out({ ok: true, media: { ...r.media, url: TRACKER_URL + r.media.url } });
      return;
    }
    case "media-delete": {
      const id = positionals[0];
      if (!id || !/^\d+$/.test(id)) throw usage("usage: media-delete <id>  (ids from media-list)");
      out(await api(`/api/media/${id}`, { method: "DELETE", auth: true }));
      return;
    }
    case "device-set": {
      const slug = positionals[0];
      if (!slug) throw usage("usage: device-set <slug> [--gpu G] [--base oneios|other] [--ios-version V] [--image-url URL] [--image-credit T] [--image-license L] [--image-source-url URL]");
      const map = { gpu: "gpu", base: "base", ios_version: "ios-version", image_url: "image-url", image_credit: "image-credit", image_license: "image-license", image_source_url: "image-source-url", best_result: "best-result", notes: "notes" };
      const b = {};
      for (const [k, fl] of Object.entries(map)) if (typeof flags[fl] === "string") b[k] = flags[fl];
      if (b.base && !["oneios", "other"].includes(b.base)) throw invalid("--base must be oneios or other");
      if (!Object.keys(b).length) throw usage("device-set: give at least one field, e.g. --ios-version \"iOS 27\"");
      out(await api(`/api/devices/${encodeURIComponent(slug)}`, { method: "PATCH", auth: true, body: b }));
      return;
    }
    case "check":
      return cmdCheck();
    case "flush":
      return cmdFlush();
    default:
      throw usage(`unknown command ${JSON.stringify(cmd)}. Run \`node ./cli.mjs --help\`.`);
  }
}

main().catch((e) => {
  if (e instanceof CliError) {
    console.error(`error: ${e.message}`);
    const args = process.argv.slice(2).filter((a, i, all) => a !== "--url" && all[i - 1] !== "--url" && !a.startsWith("--url="));
    if (e.unreachable && WRITE_COMMANDS.has(args[0])) {
      console.error(`  to send it later: node ./cli.mjs queue ${args.map(shellQuote).join(" ")}`);
    }
    process.exit(e.code);
  }
  console.error(`error: ${(e && e.stack) || e}`);
  process.exit(1);
});
