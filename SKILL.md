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
- OWNER is a GitHub organization you belong to (public member, or a contributor to the repo):
  it prints a code: write it alone to `.iosonand-verify` on the default branch, push,
  run `node cli.mjs repo-verify <claim id>`, then delete the file again. 422 = file missing or
  wrong; the claim lasts 24 h.
- Someone else's repo you have commits in: a pending claim a maintainer of it approves (a repo
  can have several maintainers). A maintainer can also add you:
  `node cli.mjs repo-maintainer-add OWNER/REPO --github LOGIN`.
- Anyone else's personal repo, or no GitHub account linked (`node cli.mjs login`): 403.
- One repo claim covers all its phones: the ones an admin lists on it, and any you add with
  `node cli.mjs repo-claim OWNER/REPO --device <device>` (yours at once unless someone else
  maintains that phone; then an admin decides).
- A repo the tracker does not list needs `--device`; `repo-add OWNER/REPO --device <device>
  --branch B --best-result "..."` adds and claims it.
- A phone the tracker does not list: find it with `node cli.mjs catalog <name or codename>`
  (every Android phone and tablet Google Play lists), then
  `repo-add OWNER/REPO --new-device "Redmi Note 7" --model lavender` (your own repo only).
- Without a repo: `node cli.mjs claim-add <device> --note "..."`, and an admin approves it.

`node cli.mjs whoami` prints `maintains` (devices), `maintains_repos` and `token_scopes`.

To keep a repo's tracker entry current across sessions, add a "Tracker" section to the repo's
agent instructions with these commands (the prompt on /docs/maintain-a-repo writes it), and keep
the key in `TRACKER_TOKEN` or the CLI login, never in a file in the repo.

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

## Find references for a port

```sh
node cli.mjs references --chip "SM7325"          # phones on that chip: repos, branch links, what works
node cli.mjs references --device <device>        # a tracked phone plus the phones on its chip
node cli.mjs references --area gpu               # where an area works, with the repo, branch and source to read
node cli.mjs catalog "<phone name or codename>"  # every Android phone and tablet (Google Play's list)
```

No login needed. The projects ports start from (OneiOS, HackiOS, ios-sweet, UniXNU, Open Mapple,
Scion): how each boots or installs and what works, on the Repos tab (`/?tab=repos&family=HackiOS`
opens one). The "Port iOS to your phone" prompt there and on each phone's page walks an agent through choosing a base and borrowing parts.

## Proof, repo facts, posts

```sh
node cli.mjs update <device> shot.png clip.mp4 --text "what changed" --area <area>   # a photo update: files + text, on the phone's page
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
