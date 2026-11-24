/**
 * src/lib/agentPrompt.ts: the prompt a maintainer pastes into their coding
 * agent to claim and manage a repo on the tracker. The text is fixed by
 * contract-v2 ("The AI prompt"); the docs page "Maintain a repo" shows the
 * same text. `site` is the tracker's origin (window.location.origin in the UI).
 */

export interface AgentPromptInput {
  site: string;
  /** OWNER/REPO; left as a placeholder when missing. */
  repo?: string;
  /** Device slug; adds ", phone: DEVICE" and fills --device. */
  device?: string;
}

export function agentPrompt({ site, repo, device }: AgentPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<OWNER/REPO>";
  const DEVICE = device?.trim() || "<device>";
  const phone = device?.trim() ? `, phone: ${device.trim()}` : "";
  return [
    `I maintain an iOS-on-Android port and want to manage it on the iOSOnAnd tracker at ${SITE}.`,
    `Repo: ${REPO}${phone}`,
    ``,
    `1. Get the tracker CLI (Node 18+, no install): curl -fsSLo cli.mjs ${SITE}/cli.mjs`,
    `2. Sign in with my GitHub account (needs the gh CLI, logged in): TRACKER_URL=${SITE} node cli.mjs login`,
    `3. Claim the repo: node cli.mjs repo-claim ${REPO} --device ${DEVICE}`,
    `   If it prints a verification code, write that code alone to .iosonand-verify on the repo's default branch, push, run node cli.mjs repo-verify <claim id>, then delete the file.`,
    `4. Read the repo (README, issues, recent commits) and record what works on the phone, one area at a time:`,
    `   node cli.mjs areas`,
    `   node cli.mjs status-set ${DEVICE} <area> works|in-progress|broken --detail "<what I can show>" --source "<link>"`,
    `   Only claim what the repo or I can show. Ask me when unsure.`,
    `5. Attach proof when I give you screenshots or clips: node cli.mjs media-upload <file> --device ${DEVICE} --area <area> --caption "..."`,
    `6. Check the result: node cli.mjs whoami`,
    `7. Set up tracker support in the repo, so its page stays current (what works, what doesn't) as we keep working:`,
    `   - .gitignore: add .env, .env.*, cli.mjs, TRACKER_QUEUE.md; the key stays in TRACKER_TOKEN or the CLI's saved login, never in a tracked file`,
    `   - add an "## iOSOnAnd tracker" section to the repo's agent instructions (AGENTS.md, and CLAUDE.md / .cursorrules if the repo uses those): this port is at ${SITE}/device/${DEVICE}; when a change makes an area work or breaks it, record it in the same session with status-set ${DEVICE} <area> <state> --detail "<what the build, log or test showed>" --source "<commit or log link>", reading status-get first; only what was shown, unproven stays unknown`,
    `   - commit only those files (check git status: no key, no .env, no cli.mjs). The full version of this step is "Keep the tracker updated from your repo" on ${SITE}/docs/maintain-a-repo`,
  ].join("\n");
}

/**
 * The prompt that adds tracker support to a port's repo: the agent keeps the
 * key out of git, adds .gitignore lines, and writes a "Tracker" section into
 * the repo's agent instructions, so every later session records progress on
 * the tracker as it happens. Shown on the profile (My repos), after a claim is
 * approved, and on /docs/maintain-a-repo.
 */
export function trackerSupportPrompt({ site, repo, device }: AgentPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<OWNER/REPO>";
  const DEVICE = device?.trim() || "<device>";
  const CLI = `TRACKER_URL=${SITE} node ~/.local/share/iosonand/cli.mjs`;
  return [
    `Add iOSOnAnd tracker support to this repo (${REPO}, phone: ${DEVICE}), so the tracker at ${SITE} stays up to date as we make progress.`,
    ``,
    `1. Get the tracker CLI outside the repo (Node 18+): mkdir -p ~/.local/share/iosonand && curl -fsSLo ~/.local/share/iosonand/cli.mjs ${SITE}/cli.mjs`,
    `2. The key never goes into git. Either sign in once with my GitHub account (gh logged in): ${CLI} login`,
    `   or I make a key at ${SITE}/profile/keys (scopes status:write, fork:write, media:write) and put it in my shell profile as TRACKER_TOKEN, or in a .env file that git ignores.`,
    `   Never write the key into a tracked file, a commit, a log, an issue or a PR.`,
    `3. Add these lines to .gitignore (create it if missing): .env, .env.*, cli.mjs, TRACKER_QUEUE.md`,
    `4. Add this section to the repo's agent instructions (AGENTS.md, or CLAUDE.md / .cursorrules if the repo uses those), so every future session follows it:`,
    ``,
    `   ## iOSOnAnd tracker`,
    `   This port is listed at ${SITE}/device/${DEVICE}. When a change makes an area of the phone work, or breaks it, update the tracker in the same session:`,
    `   - CLI: ${CLI} (download it again with the curl line above if it is missing)`,
    `   - read first: <CLI> status-get --device ${DEVICE}; the area slugs: <CLI> areas`,
    `   - record it: <CLI> status-set ${DEVICE} <area> works|in-progress|broken --detail "<what the build, log or test showed>" --source "<commit, log or PR link>"`,
    `   - say which system it was on: --os ios (the default; iPadOS too), --os macos or --os tvos, and --version "<e.g. iOS 27.2 or macOS 27.2>"`,
    `   - with screenshots or clips: <CLI> update ${DEVICE} <files...> --text "<what changed>"`,
    `   - only record what a build, log, test or capture shows; anything unproven stays unknown`,
    `   - the key comes from TRACKER_TOKEN or the CLI's saved login, never from a file in this repo`,
    `   - tracker unreachable: <CLI> queue status-set ..., then <CLI> flush later`,
    ``,
    `5. Commit only the instructions file and .gitignore. Check git status first: no key, no .env, no cli.mjs.`,
    `6. First sync: read the README, issues and recent commits, compare with status-get, and record what they show (ask me when unsure).`,
  ].join("\n");
}

/**
 * "Port iOS to your phone": the prompt that has a coding agent research the
 * phone, use the tracker (CLI, no login) to pick the base project and the
 * closest ports, find working parts (GPU, Wi-Fi, audio ...) in other repos,
 * and plan the port before changing anything. Shown on the Repos tab (/?tab=repos) and on each
 * device page (filled in with that phone).
 */
export function portPrompt({ site, device, deviceName }: { site: string; device?: string; deviceName?: string }): string {
  const SITE = site.replace(/\/+$/, "");
  const PHONE = deviceName?.trim() || "<my phone: brand, model, model number>";
  const CLI = `node cli.mjs`;
  return [
    `I want to port Apple's iOS to my phone: ${PHONE}. Help me plan and start it, using the iOSOnAnd tracker at ${SITE}, which lists every known iOS-on-Android port, its repos and branches, and what works on which phone (with sources).`,
    ``,
    `1. Get the tracker CLI (Node 18+; reading needs no login): curl -fsSLo cli.mjs ${SITE}/cli.mjs && export TRACKER_URL=${SITE}`,
    `2. Learn my phone. Search the web and the tracker for: exact model number and codename, chip (SoC part number, CPU cores and ARM version, GPU), RAM, storage (UFS or eMMC), display and touch controller, Wi-Fi chip, whether the bootloader unlocks and supports "fastboot boot" (Samsung uses Odin instead), and whether a Mu-Silicium (Windows on ARM) UEFI port exists for it.`,
    `   ${CLI} catalog "<name>"   (codenames and model numbers from Google Play's device list)${device ? `\n   ${CLI} references --device ${device}   (this phone on the tracker, and the phones on its chip)` : ""}`,
    `3. Pick the base project. Each one's page (how it boots, what works, its phones and repos) is ${SITE}/?tab=repos&family=<name>, e.g. family=HackiOS. Match my phone:`,
    `   - HackiOS (oosexgang/hakios-xnu-kernel): native XNU; fastboot boot of a Mu-Silicium UEFI and their EFI loader, iOS runs from RAM and nothing is flashed. Best for the Snapdragon 778G (SM7325) family or a phone that has a Mu-Silicium port.`,
    `   - ios-sweet (dipa-studio/ios-sweet): native XNU with a small fastboot-boot shim; the iOS root goes into userdata (erases Android's data). Best for the Snapdragon 730/732G (SM7150) family; most community ports start here.`,
    `   - UniXNU (UniXNU/UniXNU): native XNU through UEFI (UniXNU boot manager, DarwinBoot); iPadOS; tablets and recent high-end Snapdragon.`,
    `   - Open Mapple (open-mapple/manifest): native XNU on MediaTek phones, mtkloader chained into boot; Metal on Mali through Panfrost.`,
    `   - Scion (Scion-Project/scion-kernel): native XNU on Exynos phones from TWRP; iOS 16 and iOS 27 from one kernel tree.`,
    `   - OneiOS (akshaynexus/OneiOS): iOS next to One UI on a rooted Galaxy, not a native boot: a source-built XNU runs as a process on One UI's kernel, and the OneOS app (akshaynexus/OneOS, a fork of fahadalijaved/OneOS) switches between them. Nothing is flashed.`,
    `   ${CLI} references --chip "<SoC part number, e.g. SM7325>"   and again with the marketing name: the ports on the same or a close chip, their repos and branches, and what works on each. Same chip is best, same chip family next.`,
    `4. Find working parts to borrow. For each area I need (gpu for Metal or GLES acceleration, wifi, audio, touch, battery, modem ...):`,
    `   ${CLI} references --area gpu   lists the phones where it works, with the repo, branch link and source. Prefer ports with the same GPU, Wi-Fi or audio chip as mine; read their commits for that driver and reuse what fits. Keep their licenses and credit them.`,
    `   ${CLI} areas   lists the area names.`,
    `5. Write the plan and show it to me before changing anything: the repo and branch to fork as the base, then the order (memory map and board details, screen, storage, touch and buttons, then GPU, Wi-Fi, audio from the repos found), each step with the repos, files or commits to follow and the risks (unlocking, wiping data).`,
    `6. When it boots: put the port on the tracker. Sign in with my GitHub account (gh logged in): ${CLI} login, then ${CLI} repo-add OWNER/REPO ${device ? `--device ${device}` : `--device <slug> (or --new-device "<phone name>" --model <codename>)`}, record what works with ${CLI} status-set <device> <area> works|in-progress|broken --detail "<what I saw>" --source "<commit or log>", and post photos with ${CLI} update <device> <files> --text "...". Then follow "Keep the tracker updated from your repo" on ${SITE}/docs/maintain-a-repo.`,
    ``,
    `Rules: only claim what a build, log, photo or video shows; anything unproven stays unknown. Never commit API keys. Ask me before anything that wipes or flashes the phone.`,
  ].join("\n");
}
