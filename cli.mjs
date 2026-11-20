#!/usr/bin/env node
/**
 * iOSOnAnd tracker CLI — zero dependencies (node builtins only:
 * fetch, readline, fs, child_process, os, path).
 *
 *   export TRACKER_URL=http://localhost:3000   # default
 *   export TRACKER_TOKEN=...                   # overrides file storage
 *
 * Token file: ~/.config/iosonand/token (mode 0600).
 *
 * Usage: node ./cli.mjs <command> [args] [--key value]
 * Run `node ./cli.mjs --help` for the command list.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const TRACKER_URL = (process.env.TRACKER_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN_FILE = path.join(os.homedir(), ".config", "iosonand", "token");
const STATES = ["works", "broken", "in-progress", "unknown"];

function tokenSource() {
  if (process.env.TRACKER_TOKEN) return { from: "env", token: process.env.TRACKER_TOKEN.trim() };
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (t) return { from: "file", token: t };
  } catch { /* no token file */ }
  return { from: "none", token: null };
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, token.trim() + "\n", { mode: 0o600 });
}

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function info(msg) {
  console.error(msg);
}

function fail(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

async function api(p, { method = "GET", body = undefined, auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    const { token } = tokenSource();
    if (!token) fail("no token. Run `node ./cli.mjs login` first (or set TRACKER_TOKEN).");
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(TRACKER_URL + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    fail(`cannot reach ${TRACKER_URL}${p}: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = data.error || `HTTP ${res.status}`;
    const hint = data.hint ? ` (hint: ${data.hint})` : "";
    fail(`${method} ${p} -> ${err}${hint}`);
  }
  return data;
}

function run(cmd, args, { input = undefined } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (r.error) fail(`cannot run \`${cmd}\`: ${r.error.message}. Is it installed and on PATH?`);
  if (r.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` failed: ${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout || "").trim();
}

/** Parse argv into { positionals, flags }. Supports --key value, --key=value, --flag. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[a.slice(2)] = argv[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function need(flags, name, hint) {
  const v = flags[name];
  if (v === undefined || v === true || v === "") fail(`missing --${name}. ${hint || ""}`.trim());
  return v;
}

function checkState(state) {
  if (!STATES.includes(state)) {
    fail(`invalid state ${JSON.stringify(state)}. Must be one of: ${STATES.join(" | ")}`);
  }
}

function question(rl, prompt, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(prompt, (ans) => resolve(ans.trim()));
      return;
    }
    // Hidden input: mute output while typing.
    const stdin = process.stdin;
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "\u0004") return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(prompt);
    };
    stdin.on("data", onData);
    rl.question(prompt, (ans) => {
      stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(ans.trim());
    });
  });
}

async function promptPassword(promptText = "Password: ") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return await question(rl, promptText, true);
  } finally {
    rl.close();
  }
}

const HELP = `iOSOnAnd tracker CLI (zero-dep). TRACKER_URL=${TRACKER_URL}

Auth (agents + humans):
  login                 gist-proof GitHub login via gh (one-time, ~10s)
  login --token         fallback: verify \`gh auth token\` output (WARNED: shared secret)
  link --email ADDR     bind GitHub identity to an email/password account (gist-proof)
  logout                delete the stored token
  tokens                show token source + validity (value always masked)

Reads:
  areas                                     list the 24 valid area slugs
  status-get [--device SLUG] [--area SLUG]  query status (filters ?device= ?area= ?state=)
  fork-list [--device SLUG]                  list forks
  post-list [--limit N]                      list updates/posts
  claim-list [--status pending|approved|rejected]

Writes (need login):
  status-set <device> <area> <state> --detail ... --source ...
                        state in: works | broken | in-progress | unknown
  device-add <slug> [--name ...] [--model ...] [--soc ...] [--repo-kind ...]
             [--status ...] [--best-result ...] [--notes ...]
  fork-add --repo OWNER/REPO [--device SLUG] [--branch ...] [--url ...]
           [--best-result ...] [--ported ...] [--fork-only ...] [--notes ...]
  fork-sync --repo OWNER/REPO [--device SLUG] --best-result ...
  post-add --title ... --url ... [--published ...] [--note ...]
  reddit-fetch [SUBREDDIT]                   default: hackios
  claim-add --device SLUG [--note ...]
  claim-approve <id>
  user-add <email> [--admin] [--password ...]   (admin token required; prompts if omitted)

Meta:
  check                 DB reachable, seed loads, routes respond
  --help, help          this text

State vocabulary (client-side validated): works | broken | in-progress | unknown
Honesty: fork claims stay fork-claim until reproduced; merged only in main.
`;

async function cmdLogin(flags) {
  if (flags.token) {
    // Warned fallback: raw token check.
    info("WARNING: --token sends a long-lived GitHub PAT-equivalent to the server.");
    info("Prefer gist-proof `node ./cli.mjs login`. Continuing in 2s...");
    await new Promise((r) => setTimeout(r, 2000));
    const ghToken = run("gh", ["auth", "token"]);
    if (!ghToken) fail("`gh auth token` printed nothing.");
    const res = await api("/api/auth/token-check", { method: "POST", body: { token: ghToken } });
    if (!res.token) fail("server did not return a tracker token.");
    saveToken(res.token);
    out({ ok: true, method: "token-check", saved_to: TOKEN_FILE, login: res.github_login || res.login || null });
    return;
  }
  // Gist-proof flow.
  let me;
  try {
    me = JSON.parse(run("gh", ["api", "user"]));
  } catch {
    fail("could not parse `gh api user` output. Is `gh auth login` done?");
  }
  const githubLogin = me.login;
  if (!githubLogin) fail("`gh api user` returned no login.");
  info(`GitHub user: @${githubLogin}`);

  const ch = await api("/api/auth/gh-challenge", { method: "POST", body: { github_login: githubLogin } });
  if (!ch.nonce) fail("server did not return a nonce.");
  info(`Nonce: ${ch.nonce}`);
  info("Creating a SECRET gist containing the nonce...");

  const gistBody = `iOSOnAnd tracker login proof\nuser: @${githubLogin}\nnonce: ${ch.nonce}\n(delete after verify)`;
  const gistOut = run("gh", ["gist", "create", "--secret", "-d", `iosonand-login-${ch.nonce}`, "-f", "iosonand-login-proof.txt", "-"], { input: gistBody });
  const gistUrl = (gistOut.match(/https:\/\/gist\.github\.com\/\S+/) || [gistOut.split("\n").pop()])[0].trim();
  info(`Gist: ${gistUrl}`);

  const v = await api("/api/auth/gh-verify", {
    method: "POST",
    body: { github_login: githubLogin, gist_url: gistUrl, nonce: ch.nonce },
  });
  if (!v.token) fail("server did not return a tracker token.");
  saveToken(v.token);
  info("Login verified. Deleting the gist...");
  try {
    run("gh", ["gist", "delete", gistUrl]);
  } catch {
    info(`WARNING: could not delete gist. Delete manually: ${gistUrl}`);
  }
  out({ ok: true, method: "gist-proof", login: githubLogin, saved_to: TOKEN_FILE });
}

async function cmdLink(flags, positionals) {
  const email = flags.email || positionals[0];
  if (!email) fail("usage: link --email you@example.com");
  const password = flags.password || (await promptPassword("Account password: "));
  if (!password) fail("empty password.");
  let me;
  try {
    me = JSON.parse(run("gh", ["api", "user"]));
  } catch {
    fail("could not parse `gh api user` output. Is `gh auth login` done?");
  }
  const githubLogin = me.login;
  if (!githubLogin) fail("`gh api user` returned no login.");
  const ch = await api("/api/auth/gh-challenge", { method: "POST", body: { github_login: githubLogin } });
  if (!ch.nonce) fail("server did not return a nonce.");
  info(`Proving @${githubLogin} owns nonce ${ch.nonce} via secret gist...`);
  const gistBody = `iOSOnAnd tracker link proof\naccount: ${email}\nuser: @${githubLogin}\nnonce: ${ch.nonce}\n(delete after verify)`;
  const gistOut = run("gh", ["gist", "create", "--secret", "-d", `iosonand-link-${ch.nonce}`, "-f", "iosonand-link-proof.txt", "-"], { input: gistBody });
  const gistUrl = (gistOut.match(/https:\/\/gist\.github\.com\/\S+/) || [gistOut.split("\n").pop()])[0].trim();
  const res = await api("/api/auth/link", {
    method: "POST",
    body: { email, password, github_login: githubLogin, gist_url: gistUrl, nonce: ch.nonce },
  });
  try {
    run("gh", ["gist", "delete", gistUrl]);
  } catch {
    info(`WARNING: could not delete gist. Delete manually: ${gistUrl}`);
  }
  out({ ok: true, method: "link", email, login: githubLogin, detail: res });
}

async function cmdStatusSet(positionals, flags) {
  const [device, area, state] = positionals;
  if (!device || !area || !state) fail("usage: status-set <device> <area> <state> --detail ... --source ...");
  checkState(state);
  const detail = flags.detail || "";
  const source = flags.source || "";
  if (!detail) info("warning: no --detail given; status rows without evidence will be challenged.");
  if (!source) info("warning: no --source given; cite the doc/profile/log the claim comes from.");
  const res = await api("/api/status", {
    method: "PUT",
    auth: true,
    body: { device, area, state, detail, source },
  });
  out({ ok: true, device, area, state, detail, source, server: res });
}

async function main() {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === "help" || raw[0] === "--help" || raw[0] === "-h") {
    console.log(HELP);
    return;
  }
  const [cmd, ...rest] = raw;
  const { positionals, flags } = parseArgs(rest);

  if (flags.help || flags.h) {
    console.log(HELP);
    return;
  }

  switch (cmd) {
    case "login":
      await cmdLogin(flags);
      return;
    case "link": {
      await cmdLink(flags, positionals);
      return;
    }
    case "logout": {
      try {
        fs.unlinkSync(TOKEN_FILE);
        out({ ok: true, removed: TOKEN_FILE });
      } catch {
        out({ ok: true, removed: null, note: "no stored token" });
      }
      return;
    }
    case "tokens": {
      const src = tokenSource();
      const masked = src.token ? `${src.token.slice(0, 4)}…${src.token.slice(-4)}` : null;
      let validity = null;
      if (src.token && !flags["no-check"]) {
        try {
          const r = await api("/api/auth/token-check", { method: "POST", body: { token: src.token } });
          validity = { ok: true, login: r.github_login || r.login || r.email || null };
        } catch (e) {
          validity = { ok: false };
        }
      }
      out({ source: src.from, masked, validity });
      return;
    }
    case "areas": {
      const res = await api("/api/areas");
      const list = res.areas || res;
      out(Array.isArray(list) ? list : res);
      return;
    }
    case "status-get": {
      const q = new URLSearchParams();
      if (flags.device) q.set("device", flags.device);
      if (flags.area) q.set("area", flags.area);
      if (flags.state) {
        checkState(flags.state);
        q.set("state", flags.state);
      }
      const qs = q.toString() ? `?${q}` : "";
      out(await api(`/api/status${qs}`));
      return;
    }
    case "status-set":
      await cmdStatusSet(positionals, flags);
      return;
    case "device-add": {
      const slug = positionals[0] || flags.slug;
      if (!slug) fail("usage: device-add <slug> [--name ...] [--model ...] [--soc ...] ...");
      const body = {
        slug,
        name: flags.name || slug,
        model: flags.model || "",
        soc: flags.soc || "",
        repo_kind: flags["repo-kind"] || "fork",
        status: flags.status || "unknown",
        best_result: flags["best-result"] || "",
        notes: flags.notes || "",
      };
      if (flags.status) checkState(flags.status);
      out(await api("/api/devices", { method: "POST", auth: true, body }));
      return;
    }
    case "fork-add": {
      const repo = flags.repo || positionals[0];
      if (!repo) fail("usage: fork-add --repo OWNER/REPO [--device SLUG] ...");
      out(
        await api("/api/forks", {
          method: "POST",
          auth: true,
          body: {
            repo,
            device_slug: flags.device || "",
            branch: flags.branch || "",
            url: flags.url || (repo.includes("/") ? `https://github.com/${repo}` : repo),
            best_result: flags["best-result"] || "",
            ported: flags.ported || "",
            fork_only: flags["fork-only"] || "",
            notes: flags.notes || "",
          },
        })
      );
      return;
    }
    case "fork-sync": {
      const repo = flags.repo || positionals[0];
      if (!repo) fail("usage: fork-sync --repo OWNER/REPO [--device SLUG] --best-result ...");
      out(
        await api("/api/forks/sync", {
          method: "POST",
          auth: true,
          body: {
            repo,
            device_slug: flags.device || "",
            best_result: flags["best-result"] || "",
            ported: flags.ported || "",
            fork_only: flags["fork-only"] || "",
            notes: flags.notes || "",
          },
        })
      );
      return;
    }
    case "fork-list": {
      const q = flags.device ? `?device=${encodeURIComponent(flags.device)}` : "";
      out(await api(`/api/forks${q}`));
      return;
    }
    case "post-add": {
      const title = flags.title || positionals[0];
      const url = flags.url;
      if (!title || !url) fail("usage: post-add --title ... --url ... [--published ...] [--note ...]");
      out(
        await api("/api/posts", {
          method: "POST",
          auth: true,
          body: { title, url, published: flags.published || "", note: flags.note || "" },
        })
      );
      return;
    }
    case "post-list": {
      const q = flags.limit ? `?limit=${encodeURIComponent(flags.limit)}` : "";
      out(await api(`/api/posts${q}`));
      return;
    }
    case "reddit-fetch": {
      const sub = positionals[0] || flags.subreddit || "hackios";
      out(await api("/api/reddit/fetch", { method: "POST", auth: true, body: { subreddit: sub } }));
      return;
    }
    case "claim-add": {
      const device = flags.device || positionals[0];
      if (!device) fail("usage: claim-add --device SLUG [--note ...]");
      out(await api("/api/claims", { method: "POST", auth: true, body: { device_slug: device, note: flags.note || "" } }));
      return;
    }
    case "claim-list": {
      const q = flags.status ? `?status=${encodeURIComponent(flags.status)}` : "";
      out(await api(`/api/claims${q}`));
      return;
    }
    case "claim-approve": {
      const id = positionals[0];
      if (!id) fail("usage: claim-approve <id>");
      out(await api(`/api/claims/${encodeURIComponent(id)}/approve`, { method: "POST", auth: true }));
      return;
    }
    case "user-add": {
      const email = positionals[0] || flags.email;
      if (!email) fail("usage: user-add <email> [--admin] (admin token required)");
      const password = flags.password || (await promptPassword(`Password for ${email}: `));
      if (!password) fail("empty password.");
      out(
        await api("/api/users", {
          method: "POST",
          auth: true,
          body: { email, password, is_admin: flags.admin ? 1 : 0 },
        })
      );
      return;
    }
    case "check": {
      const results = {};
      const step = async (name, fn) => {
        try {
          const r = await fn();
          results[name] = { ok: true, detail: r };
        } catch (e) {
          results[name] = { ok: false, detail: String((e && e.message) || e) };
        }
      };
      // Routes respond.
      await step("docs", () => api("/api/docs"));
      // Seed loads: areas table must hold the 24 checklist areas.
      await step("areas_seed", async () => {
        const r = await api("/api/areas");
        const list = r.areas || r;
        const n = Array.isArray(list) ? list.length : 0;
        if (n < 24) throw new Error(`expected >= 24 seeded areas, got ${n}`);
        return `${n} areas`;
      });
      // DB reachable: devices read path.
      await step("devices", async () => {
        const r = await api("/api/devices?limit=1");
        return Array.isArray(r.devices || r) ? "read ok" : "read ok (non-list shape)";
      });
      const allOk = Object.values(results).every((r) => r.ok);
      out({ tracker: TRACKER_URL, ok: allOk, checks: results });
      if (!allOk) process.exit(1);
      return;
    }
    default:
      fail(`unknown command ${JSON.stringify(cmd)}. Run with --help.`);
  }
}

main().catch((e) => fail(String((e && e.message) || e)));
