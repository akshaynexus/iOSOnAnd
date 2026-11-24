---
title: "HakiOS registry"
description: "How the HakiOS ports registry (hakios-developers.com) is combined with the tracker, and which side wins."
---

[hakios-developers.com](https://hakios-developers.com/#/ports) is the HakiOS ports registry:
porters submit their phone, repo and a per-feature checklist there. `scripts/sync-hakios.mjs`
reads its public JSON and writes it into the tracker through the API, so both lists show up on
one site.

## Run it

```sh
node scripts/sync-hakios.mjs                       # dry run: prints the plan, writes hakios-sync-report.json
node scripts/sync-hakios.mjs --apply               # writes it (admin token)
node scripts/sync-hakios.mjs --apply --url https://<tracker>
```

The token is `TRACKER_TOKEN`, or the CLI's saved token for that URL
(`node cli.mjs login --admin` on a local dev server). The run is safe to repeat: a second run
with nothing new on the registry writes nothing.

## What it reads

| Registry endpoint | What it has |
|---|---|
| `GET /api/ports` | each approved port: device, codename, SoC, Darwin or iOS version, status (`home`, `boots`, `wip`), nine feature states, repo URL, author |
| `GET /api/forks?offset=N` | the GitHub forks of `oosexgang/hakios-xnu-kernel`, 60 a page, with stars, branch, last push and an active flag |
| `GET /api/meta` | counts and the lists of statuses and feature states |

Also public and not imported: `/api/wanted` (phones people vote for), `/api/roadmap`, the forum
(`/api/forum/topics`, `/api/forum/gallery`).

## What it writes

- **Phones.** A port's codename maps to our device in `scripts/hakios-map.json` (`codenames`).
  Phones we did not track are in `new_devices` there and get added; on phones we have, only
  empty fields (SoC, iOS version, best result, an unknown status) are filled.
- **Repos.** Each port's repo becomes a repo row for that phone: `kind` fork when GitHub lists
  it as a fork, else standalone; `base_project` from the map's `repos`, else HackiOS; the
  "based on" row is its GitHub fork parent. A repo we already track keeps its fields and only
  gains the phone in its supported list. Repos that are not public (GitHub 404) are not linked.
- **Kernel forks.** Of the 470 forks, only those whose name or branch names a known codename
  (for example `-munch`, branch `fajita`) are added; the rest are empty copies.
- **States.** The source of every cell is the port's registry page (badge "HakiOS registry").

| Registry | Tracker area |
|---|---|
| status `home` / `boots`, `wip` | Boot to Home Screen: works / in progress |
| touch and buttons | Touch + buttons (both yes: works, both no: broken, else in progress) |
| gpu, wifi, bluetooth, audio | the area of the same name |
| cellular | Cellular modem |
| charging | Battery reporting |
| display | not stored: it is implied by the boot state |

`yes` is works, `partial` in progress, `no` broken; `unknown` is not written. When several ports
cover one phone, the best state of each area wins.

## Which side wins

A cell is written only when:

1. ours is empty or unknown, or
2. ours came from an earlier run of the sync (its detail starts with "HakiOS registry"), or
3. the registry reports more progress (works, then in progress, then broken) than our row.

A maintainer's row is never changed. Everything the sync wrote or left alone, with the reason,
is in the report file.
