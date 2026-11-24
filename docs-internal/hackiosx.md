---
title: "hackiosx.dev"
description: "How the hackiosx.dev project pages are combined with the tracker, and why its sentences are mapped by hand."
---

[hackiosx.dev](https://hackiosx.dev/projects) documents the projects that boot iOS on Android
phones: HackiOS, ios-sweet and UniXNU, each with a list of what works and what is missing, and a
table of community ports. `scripts/sync-hackiosx.mjs` reads that page and writes what it states
into the tracker through the API.

## Run it

```sh
node scripts/sync-hackiosx.mjs                       # dry run: prints the plan, writes hackiosx-sync-report.json
node scripts/sync-hackiosx.mjs --apply               # writes it (admin token)
node scripts/sync-hackiosx.mjs --apply --url https://<tracker>
```

The token is `TRACKER_TOKEN`, or the CLI's saved token for that URL
(`node cli.mjs login --admin` on a local dev server). The run is safe to repeat: a second run
with nothing new on the site writes nothing.

## What it reads

The site is hand-written HTML with no API. From `GET /projects` the sync reads:

| Part of the page | What it has |
|---|---|
| sections `#hackios`, `#ios-sweet`, `#unixnu` | the project's "Works" and "Missing" lists |
| section `#community-ports` | one row per port: phone (linked to its repo), chip, based on, state |

The other pages (how it works, compatibility by chip family, porting guide, open problems) are
guides, not per-phone results, and are not imported.

## Sentences, not fields

The site says things like "Home screen with touch and buttons, all 8 cores, Wi-Fi with Safari".
A script that guessed states from such text could claim more than the page says, so
`scripts/hackiosx-map.json` says, sentence by sentence, which areas each one supports. It was
checked by hand against the page.

- A sentence on the page that the map does not have is reported as `unmapped` and writes nothing.
  So does a community port whose state text changed.
- A sentence the map has but the page no longer shows is reported as `gone` and is not written.
- When the site changes, read the report, update the map, and run the sync again.

Some readings the map makes on purpose:

- "Touchscreen" without buttons is Touch + buttons in progress, not works.
- "SpringBoard runs" and "iOS setup screen" are Boot to Home Screen in progress.
- A project's "Missing" item is broken for that project's phone ("Charging while iOS runs" is
  Battery reporting broken).
- Items that name no tracker area (Settings, Sileo, 8 cores) write nothing.

## What it writes

- **Phones.** The map's `new_devices` are added when the page lists them (the Redmi Note 12 4G
  was the first). On phones we have, only an empty SoC or best result is filled.
- **Repos.** Each project's repos and each community port's repo get the phone in their supported
  list (`claimed`). A repo the page links under an old name is matched through `repo_aliases`
  (GitHub redirects it). A repo we do not track is added only when the map's `repos` has it,
  checked on GitHub.
- **States.** The source of every cell is the page section (badge "hackiosx.dev"), and the detail
  quotes the sentence: `hackiosx.dev (UniXNU): missing: Battery driver, sleep and wake`. Of
  several sentences about one cell, the best state wins.

## Which side wins

A cell is written only when:

1. ours is empty or unknown, or
2. ours came from an earlier run of the sync (its detail starts with "hackiosx.dev"), or
3. the site reports more progress (works, then in progress, then broken) than our row.

A maintainer's row is never changed. The site describes each project's upstream state, so a fork
with more progress keeps its own row: the Redmi Note 10 Pro keeps its Reddit-claimed Wi-Fi even
though ios-sweet lists Wi-Fi as missing. Everything the sync wrote or left alone, with the
reason, is in the report file.
