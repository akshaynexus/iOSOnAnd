---
title: "Reddit"
description: "How r/hackios posts and the claims in them get into the tracker, and why they stay claims."
---

Many ports are announced on r/hackios before any code or logs are public. The tracker keeps
those posts as links on the Updates tab, and records what they say as claims, not as verified
state.

## How posts get in

| Path | Who | What it does |
|---|---|---|
| `seed/seed.json` | the seed | `reddit_posts` rows and `device_status` rows read from r/hackios threads |
| `node cli.mjs post-add --title "..." --link URL` | admin, or a maintainer of any device | adds one post (`POST /api/posts`) |
| `node cli.mjs reddit-fetch [SUBREDDIT]` | admin | `POST /api/reddit/fetch`: finds the subreddit's (default `hackios`) posts that mention "OneiOS" in the Arctic Shift archive (Reddit's own search when the archive fails), newest first, and stores posts not seen before; the response's `source` says which answered |
| `node scripts/sync-reddit.mjs [--apply]` | admin | reads every new thread and its comments, adds port posts, the phones and repos they are about, and (with `--claims`) the porters' own status claims (below) |

Rules for a post URL:

- It must be `https://www.reddit.com/r/...`, `https://old.reddit.com/r/...` or
  `https://redd.it/<id>`.
- It is stored in one form, `https://www.reddit.com/...` without a query, so the same post is not
  added twice. A duplicate is 409.

`reddit-fetch` runs only when an admin calls it; there is no scheduled fetch. When the archive
and Reddit both fail and nothing was added, it returns 502 with a hint to retry in a few minutes.
Posts are links, not embeds. A post may carry a thumbnail from the post itself (`image_url`,
`image_width`, `image_height`; an admin sets it with `node cli.mjs post-set <id> --image-url URL`).

## The sync script

`scripts/sync-reddit.mjs` reads r/hackios from the [Arctic Shift](https://arctic-shift.photon-reddit.com)
archive of Reddit, which answers from networks Reddit refuses: the posts since `--since`
(default: three days before the newest post the tracker has; `--all`: the whole history) and
every comment in the subreddit since then. A comment on an older post brings that post in too,
so a porter's update in an old thread is read.

```sh
node scripts/sync-reddit.mjs                    # dry run: prints the plan, writes reddit-sync-report.json
node scripts/sync-reddit.mjs --apply            # writes it (admin token)
node scripts/sync-reddit.mjs --apply --url https://<tracker> --since 2026-10-01
node scripts/sync-reddit.mjs --claims --apply                 # new posts, phones, repos and claims
node scripts/sync-reddit.mjs --all --save DIR                 # the whole history, kept in DIR
node scripts/sync-reddit.mjs --input DIR --since 2015-01-01 --claims --apply   # rerun from the saved copy
node scripts/sync-reddit.mjs --source reddit                  # Reddit's own JSON instead of the archive
```

It reads posts by week and comments by day (the archive times out on wide comment queries), the
windows in parallel, with at most `--concurrency` requests in flight (default 4, at most 8). It
follows the archive's `x-ratelimit-*` headers, waiting for the reset when few requests remain,
and backs off on 429, 5xx and the archive's "slow down" timeout. A run since the last sync takes
about 15 requests and a few seconds; the whole of r/hackios (about 730 posts and 7,700 comments)
about 130 requests and a minute. `--save DIR` keeps the responses as `posts.json` and
`comments.json`, so later runs can use `--input DIR` without fetching again.

Whose words count: the thread's author, in the post and in their own comments, and a commenter
linking a repo under their own GitHub name. A repo someone else links counts when its own name
points to exactly one phone, by a codename (`hakios-apollo`, `ios-guacamole`) or a phone name
(`oneios-s25-ultra`); it is filed under that phone. A repo named like a main project
(`ios-sweet`) points to no phone. Other repos are only listed in the report.

Which thread is about which phone: a tracked phone named in the title, else in the body, else a
codename in the name of a repo the porter linked (codenames such as `sweet` or `lisa` are plain
words, so free text does not count). Names match in the forms people write them: "Note 8" for
"Note8", "Motorola G Play 2023" for "Moto G Play (2023)", "Samsung S20", and model numbers
("SM-G930F", "i9100"). Codenames come from `scripts/hakios-map.json`, `scripts/reddit-map.json`
and each phone's codename-like `model`. A title that names a phone maker but no tracked phone is
reported as a phone to add, not matched to a phone the body mentions.

`scripts/reddit-map.json` holds the phones threads port to that the tracker did not list
(`new_devices`, with names, codenames and chips from `GET /api/catalog`), extra name `aliases`,
`codenames`, and `reject_claims` (below). A listed phone is added when a thread about it is
kept.

| It writes | When |
|---|---|
| a phone | `reddit-map.json` lists it, and a kept thread or a repo is about it |
| a post | the thread is not tracked, names a tracked phone, and its author links a repo; or it names one phone, has a port flair (including HackiOS and HackiPadOS), shows a photo or video, and its title is not a question or a request for help |
| a repo (`fork-claim`) | the porter links it, it is on GitHub, it is not tracked, and the thread names exactly one phone; `kind` and `base_project` come from GitHub, lineage from the tracker's own GitHub lookup |
| a supported phone (`claimed`) | a tracked repo, linked by the porter in a thread about a phone it does not list yet |

Without `--claims` it writes no states: the report's `claims_to_review` lists each thread with
the porter's sentences and the `status-set` line to write a claim with. With `--claims` it reads
those sentences itself, for threads about one phone:

- A sentence counts when it names an area and says plainly how it is: "Wi-Fi works",
  "✅ Bluetooth: Working" or "Working: touch, battery..." is `works`; "Bluetooth is not
  working", "no camera" or "won't start" is `broken`; "camera (working on it)", "laggy" or
  "somewhat working" is `in-progress`. Boot to Home counts only when the Home Screen, lock screen
  or SpringBoard is reached.
- Plans, conditions and questions are skipped ("will", "once", "trying to get", "next",
  "if", "anyone"...), as are sentences about another system (Windows, Linux). A sentence that
  says macOS runs ("macOS boots", "About this Mac now works") goes to the phone's macOS boot row
  (`boot` with `os` `macos`).
- The row quotes the sentence: `reddit claim (YYYY-MM-DD): "<sentence>"`, with the thread as its
  source. A later thread's word on an area wins.
- It writes only where the phone has no row for that area, the row is `unknown`, or the row is
  an older reddit claim, and never lowers a state. A maintainer's or a registry's row is kept.
- `reject_claims` in `reddit-map.json` lists rows a person read and found the sentence does not
  say (it is about another phone, or code that is in a tree but not shown running).

The report also lists threads about phones the tracker does not have and repos linked without a
tracked phone.

Reddit refuses some networks (403, "blocked by network security"). The script then stops with
that message; use the archive (the default), run it from another network, or save Reddit's JSON responses to a
folder and pass `--input DIR` (`posts.json`: an array of posts, `comments.json`: an array of
comments).

## Why they stay claims

A Reddit post is the porter's own statement, usually a video or a screenshot. Nobody has rebuilt
or rerun it. So:

- A status taken from a thread has `detail` starting with `reddit claim (YYYY-MM-DD):`, the date
  the thread was read, and `source` set to the thread's permalink. The UI shows the source link
  next to the state.
- A fork found through Reddit is `fork-claim` until someone reproduces it on hardware. Only an
  admin moves it to `reproduced` or `merged`.
- Nothing is inferred beyond what the post says. An area the post does not mention stays
  `unknown`.

To replace a claim with a verified state, a maintainer of the device writes the status with their
own `--detail` and `--source` (a log, a commit, a session folder). See
[Agent system](/docs/agents).
