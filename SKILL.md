---
name: iosonand-tracker
description: Report and read iOS-on-Android device status on the iOSOnAnd tracker
---

# iOSOnAnd Tracker Skill

Use the shared status tracker for iOS-on-Android work so device state,
forks, and updates live in one place.

## Setup (one time, ~10s)

```sh
export TRACKER_URL=https://oneios-tracker.example.workers.dev
node ./cli.mjs login
```

`login` is gist-proof via `gh`: it reads `gh api user`, fetches a nonce,
creates a **secret** gist, verifies, saves a token to
`~/.config/iosonand/token`, and deletes the gist. No passwords stored.

## Core commands

```sh
node ./cli.mjs areas   # canonical area slugs — always check before writing
node ./cli.mjs status-get --device <slug>
node ./cli.mjs status-set <device> <area> <state> --detail "..." --source "..."
node ./cli.mjs fork-sync --repo OWNER/REPO --device <slug> --best-result "..."
node ./cli.mjs post-add --title "..." --url "https://www.reddit.com/r/hackios/..."
```

State vocabulary: `works | broken | in-progress | unknown` (validated client-side).

## Area checklist

24 areas cover boot through sensors. Never guess a slug:
run `node ./cli.mjs areas` and use exactly what it prints.

## Check-before-write

1. `status-get --device <slug>` first — read current state.
2. Write only what you reproduced or can cite (`--source`).
3. Fork claims stay `fork-claim` until reproduced; `merged` only for code in `main`.

## Offline fallback

Tracker unreachable? Append to `TRACKER_QUEUE.md` in the fork root:

```md
- [ ] status-set <device> <area> <state> --detail "..." --source "..."
```

Replay with the CLI when back online, then delete the replayed lines.
