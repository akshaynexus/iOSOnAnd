---
name: iosonand-tracker
description: Read and update iOS-on-Android device status on the iOSOnAnd tracker; claim a port's repo, record what works with sources, upload proof
---

# iOSOnAnd tracker

The tracker holds, per phone, the state of 24 checklist areas, the repos that support it, what
they are based on, proof uploads and Reddit posts. You work with it through `cli.mjs`: one file,
Node 18 or newer, nothing to install. The tracker's `/docs/agents` page explains this flow;
`/docs/permissions` covers who may write what.

## Get the CLI and pick the tracker

```sh
curl -fsSLo cli.mjs https://<tracker>/cli.mjs     # the CLI that matches this tracker
export TRACKER_URL=https://<tracker>              # or --url URL; default http://localhost:3000
node cli.mjs check                                # must print "ok": true
```

## Log in once per tracker

```sh
node cli.mjs login              # GitHub gist proof (gh must be logged in); the CLI deletes the gist after
node cli.mjs login --admin      # local dev only: ADMIN_EMAIL / ADMIN_PASSWORD from .dev.vars
TRACKER_PASSWORD=... node cli.mjs login --email ADDR
```

The token is saved per tracker URL in `~/.config/iosonand/tokens.json`. An API key works
instead: `TRACKER_TOKEN=ion_... node cli.mjs ...` (or `--token ion_...`). A key has scopes
(`all`, `read`, `status:write`, `fork:write`, `post:write`, `media:write`); a missing scope is
403 `token scope` with the hint `needs <scope>`.

## Own the repo

```sh
node cli.mjs repo-claim OWNER/REPO --device <device>
```

- Your GitHub login is OWNER: approved at once; you maintain the repo and its phone.
- Otherwise it prints a code: write it alone to `.iosonand-verify` on the default branch, push,
  run `node cli.mjs repo-verify <claim id>`, then delete the file again. 422 = file missing or
  wrong; the claim lasts 24 h.
- A repo the tracker does not list needs `--device`; `repo-add OWNER/REPO --device <device>
  --branch B --best-result "..."` adds and claims it.
- Without a repo: `node cli.mjs claim-add <device> --note "..."`, and an admin approves it.

`node cli.mjs whoami` prints `maintains` (devices), `maintains_repos` and `token_scopes`.

## Update status

```sh
node cli.mjs areas                              # valid area slugs and their scope
node cli.mjs status-get --device <device>       # read first
node cli.mjs status-set <device> <area> <state> --detail "what you saw" --source "file, log, commit or link"
node cli.mjs status-get --device <device> --area <area>   # read back
```

States: `works | broken | in-progress | unknown`. The CLI rejects other states and unknown area
slugs before it sends. `return-to-oneui`, `ipc` and `kernel-mem` apply only to OneiOS-based ports:
for any other phone the server answers 400 `area not applicable`.

## Proof, repo facts, posts

```sh
node cli.mjs media-upload shot.png --device <device> --area <area> --caption "..."   # images 15 MB, videos 95 MB
node cli.mjs media-list --device <device>
node cli.mjs fork-sync --repo OWNER/REPO --best-result "boots to lock screen"
node cli.mjs repo-lineage OWNER/REPO --base dipa-studio/ios-sweet --relation derived-from --note "README"
node cli.mjs repo-support OWNER/REPO <other-device> --support claimed --note "..."
node cli.mjs post-add --title "..." --link "https://www.reddit.com/r/hackios/..."
```

## Rules

- Write only what you reproduced or can cite in `--source`. Ask the maintainer when unsure.
- A fork's claim stays `fork-claim` until reproduced. `merged` means the code is in OneiOS `main`.
  Only an admin sets either.
- `unknown` where nothing is proven.
- Read before you write and never overwrite an authoritative row (one from the port's
  maintainer, e.g. detail ending `(OneiOS maintainer, date)`) with a weaker source.
- Delete `.iosonand-verify` after `repo-verify`.
- On an error, read the `hint` and act on it; do not retry blindly.

## When the tracker is unreachable

```sh
node cli.mjs queue status-set <device> <area> <state> --detail "..." --source "..."
node cli.mjs flush      # later; sends in order, keeps the lines that fail
```

`queue` writes to `./TRACKER_QUEUE.md` (or `$TRACKER_QUEUE`). A write that fails because the
tracker is unreachable prints the exact `queue` command to run.

Exit codes: 0 ok, 1 server or validation error (the server's error and hint are printed), 2
usage error.
