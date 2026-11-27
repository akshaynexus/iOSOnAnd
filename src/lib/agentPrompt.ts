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
  /** A phone the tracker does not list yet: the claim adds it (repo-add --new-device). */
  newDevice?: { name: string; model?: string; soc?: string };
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function agentPrompt({ site, repo, device, newDevice }: AgentPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<OWNER/REPO>";
  const DEVICE = device?.trim() || "<device>";
  const fresh = newDevice?.name.trim() ? newDevice : undefined;
  const phone = fresh ? `, phone: ${fresh.name.trim()} (not on the tracker yet)` : device?.trim() ? `, phone: ${device.trim()}` : "";
  // Without a repo or phone the agent works them out: the repo in its folder, the phone on the tracker (or added).
  const findRepo = !repo?.trim()
    ? [`   <OWNER/REPO> is the repo in this folder: git remote get-url origin (ask me if there is none).`]
    : [];
  const findPhone = !device?.trim() && !fresh
    ? [
        `   <device> is the phone this port is for. Find its slug: node cli.mjs status-get, or node cli.mjs references --chip "<SoC>"; if the tracker does not list it, use node cli.mjs repo-add <OWNER/REPO> --new-device "<phone name>" --model <codename> --soc "<chip>" instead of repo-claim (node cli.mjs catalog "<name>" gives the name and codename).`,
      ]
    : [];
  return [
    `I maintain an iOS-on-Android port and want to manage it on the iOSOnAnd tracker at ${SITE}.`,
    repo?.trim() || phone ? `Repo: ${REPO}${phone}` : `The port's repo is the one in this folder.`,
    ``,
    `1. Read the tracker skill first (${SITE}/SKILL.md) and follow its rules (ask me once how tracker updates and release posts should go — auto, ask or off, saved in ~/.config/iosonand/agent-prefs.json; always ask and show the file and caption before uploading any image or video; no personal data or vendor files).`,
    `   Get the tracker CLI outside the repo (Node 18+, no install; read it and note its sha256 before running):`,
    `   mkdir -p ~/.local/share/iosonand && curl -fsSLo ~/.local/share/iosonand/cli.mjs ${SITE}/cli.mjs && sha256sum ~/.local/share/iosonand/cli.mjs`,
    `   Use CLI="node ~/.local/share/iosonand/cli.mjs" with TRACKER_URL=${SITE} (shown below as "node cli.mjs").`,
    `2. Sign in with my GitHub account (needs the gh CLI, logged in; gist proof only): TRACKER_URL=${SITE} node cli.mjs login`,
    ...findRepo,
    ...findPhone,
    fresh
      ? `3. Claim the repo and add the phone, which the tracker does not list yet: node cli.mjs repo-add ${REPO} --new-device ${q(fresh.name.trim())}${fresh.model?.trim() ? ` --model ${q(fresh.model.trim())}` : ""}${fresh.soc?.trim() ? ` --soc ${q(fresh.soc.trim())}` : ""}. It prints the new phone's slug: use it as <device> below.`
      : `3. Claim the repo: node cli.mjs repo-claim ${REPO} --device ${DEVICE}`,
    `   Repos under my own GitHub account are approved at once (the gist sign-in above proves the account). Only an organization's repo prints a verification code: never commit it to the main branch; push it on a throwaway branch instead: git switch --orphan iosonand-verify && printf '%s\n' '<code>' > .iosonand-verify && git add .iosonand-verify && git commit -m 'iOSOnAnd verification' && git push origin iosonand-verify && git switch -, then node cli.mjs repo-verify <claim id>, then delete the branch: git push origin --delete iosonand-verify && git branch -D iosonand-verify`,
    `4. Read the repo (README, issues, recent commits) and record what works on the phone, one area at a time:`,
    `   node cli.mjs areas`,
    `   node cli.mjs status-set ${DEVICE} <area> works|in-progress|broken --detail "<what I can show>" --source "<public link>"`,
    `   Say which system it is on: --os ios (the default; iPadOS too), --os macos or --os tvos, with --version "<e.g. iOS 27.2>".`,
    `   Only claim what a log, capture or pushed doc shows. Ask me when unsure, and before changing a state set by hand.`,
    `   Something the areas don't cover, or uncommon hardware that works (an IR blaster, a stylus, a second screen): node cli.mjs feature-add ${DEVICE} "<name>" works --detail "..." --source "<link>"`,
    `   A GPU problem you can name (white widgets, black blurs, GPU faults, out of memory): node cli.mjs gpu-issue-add ${DEVICE} "<symptom>" --kind white-widgets|black-ui|gpu-fault|out-of-memory|artifacts|slow|crash|other --cause "<what causes it>" [--fix "<what fixed it>" --state fixed] --source "<log or commit>"`,
    `   How the GPU acceleration works and how fast, when the repo or I can show it: node cli.mjs gpu-set ${DEVICE} --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu|other --stack "<chain, e.g. AdrenoMetal -> metal2vulkan -> Turnip>" --fps 40-58 --fps-note "<what was measured>" --repos OWNER/REPO --source "<link>"`,
    `5. Attach proof only after asking me (show me the exact file and caption first, even if updates are set to auto): add --photo <file> (repeatable) to the status-set or feature-add it proves, or node cli.mjs media-upload <file> --device ${DEVICE} --area <area> --caption "..."`,
    `6. Check the result: node cli.mjs whoami`,
    `7. Set up tracker support and the skill in the repo, so its page stays current as we keep working:`,
    `   - install the skill: mkdir -p .claude/skills/iosonand-tracker && curl -fsSLo .claude/skills/iosonand-tracker/SKILL.md ${SITE}/SKILL.md`,
    `   - .gitignore: add .env, .env.*, cli.mjs, TRACKER_QUEUE.md; the key stays in TRACKER_TOKEN or the CLI's saved login, never in a tracked file`,
    `   - add an "## iOSOnAnd tracker" section to the repo's agent instructions (AGENTS.md, and CLAUDE.md / .cursorrules if the repo uses those): this port is at ${SITE}/device/${DEVICE} (repo ${REPO}, phone ${DEVICE}); follow the iosonand-tracker skill (.claude/skills/iosonand-tracker/SKILL.md; latest at ${SITE}/SKILL.md) — ask the user once how tracker updates and release posts should go (auto, ask, off in ~/.config/iosonand/agent-prefs.json), update after a phone boot or release as they chose, always ask before uploading any image or video, and only claim what a log, capture or pushed doc shows`,
    `   - commit only those files (check git status: no key, no .env, no cli.mjs). The full version of this step is "Keep the tracker updated from your repo" on ${SITE}/docs/maintain-a-repo`,
  ].join("\n");
}

/**
 * The prompt that adds tracker support to a port's repo: installs the
 * iosonand-tracker skill, keeps the key out of git, adds .gitignore lines, and
 * writes a "Tracker" section into the repo's agent instructions, so every
 * later session records progress on the tracker according to the maintainer's
 * preferences. Shown on the profile (My repos), after a claim is approved, and
 * on /docs/maintain-a-repo.
 */
export function trackerSupportPrompt({ site, repo, device }: AgentPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<OWNER/REPO>";
  const DEVICE = device?.trim() || "<device>";
  const CLI = `TRACKER_URL=${SITE} node ~/.local/share/iosonand/cli.mjs`;
  return [
    `Add iOSOnAnd tracker support and the tracker skill to this repo (${REPO}, phone: ${DEVICE}), so the tracker at ${SITE} stays up to date as we make progress.`,
    ``,
    `1. Install the tracker skill into the repo and read it:`,
    `   mkdir -p .claude/skills/iosonand-tracker && curl -fsSLo .claude/skills/iosonand-tracker/SKILL.md ${SITE}/SKILL.md`,
    `2. Get the tracker CLI outside the repo (Node 18+; read it and note its sha256 before running):`,
    `   mkdir -p ~/.local/share/iosonand && curl -fsSLo ~/.local/share/iosonand/cli.mjs ${SITE}/cli.mjs && sha256sum ~/.local/share/iosonand/cli.mjs`,
    `3. The key never goes into git. Either sign in once with my GitHub account (gh logged in, gist proof): ${CLI} login`,
    `   or I make a key at ${SITE}/profile/keys (scopes status:write, fork:write, media:write) and put it in my shell profile as TRACKER_TOKEN, or in a .env file that git ignores.`,
    `   Never write the key into a tracked file, a commit, a log, an issue or a PR, and never ask me to paste a token into chat.`,
    `4. Add these lines to .gitignore (create it if missing): .env, .env.*, cli.mjs, TRACKER_QUEUE.md`,
    `5. Add this section to the repo's agent instructions (AGENTS.md, or CLAUDE.md / .cursorrules if the repo uses those), so every future session follows it:`,
    ``,
    `   ## iOSOnAnd tracker`,
    `   This port's per-phone status is on the iOSOnAnd tracker (${SITE}/device/${DEVICE}), repo ${REPO}, phone ${DEVICE}.`,
    `   Follow the iosonand-tracker skill (.claude/skills/iosonand-tracker/SKILL.md; latest at ${SITE}/SKILL.md):`,
    `   - CLI: ${CLI} (keep it outside the repo; read and check its sha256 when downloaded or updated)`,
    `   - first use: ask the user once how tracker updates and release posts should go (auto, ask or off) and save the answers in ~/.config/iosonand/agent-prefs.json (never committed)`,
    `   - read first: <CLI> status-get --device ${DEVICE}; the area slugs: <CLI> areas`,
    `   - record after a phone boot: <CLI> status-set ${DEVICE} <area> works|in-progress|broken --detail "<phone model, build, date, log line>" --source "<public commit, doc or issue URL>" --os ios|macos|tvos --version "<e.g. iOS 27.2>"`,
    `   - GPU acceleration and issues: <CLI> gpu-set ${DEVICE} ... and <CLI> gpu-issue-add ${DEVICE} ...; notable extra hardware: <CLI> feature-add ${DEVICE} ...`,
    `   - release updates (per posts pref): <CLI> update ${DEVICE} --text "<release summary and URL>" (post-add is for Reddit links only)`,
    `   - images and videos: always ask and show the exact file and caption before any --photo, media-upload or update with files, even when updates are set to auto`,
    `   - no personal data, no vendor files, no keys in git; only claim what a log, capture or pushed doc shows; unproven stays unknown`,
    `   - tracker unreachable: <CLI> queue status-set ..., then <CLI> flush later`,
    ``,
    `6. Commit only the skill file (.claude/skills/iosonand-tracker/SKILL.md), the instructions file and .gitignore. Check git status first: no key, no .env, no cli.mjs.`,
    `7. Ask me my update preferences for ~/.config/iosonand/agent-prefs.json (auto, ask or off), then read the README, issues and recent commits, compare with status-get, and propose what to sync.`,
  ].join("\n");
}

/**
 * "Port iOS to your device": the prompt that has a coding agent use the
 * tracker (CLI or API, reads need no login) to find the existing ports for the
 * phone or its chip and what works on them, find GPU acceleration and other
 * driver code that fits its specs, pick the base project, and plan the port
 * (Rust first, C/C++ only where needed) before changing anything. Then it puts
 * the new repo and phone on the tracker as soon as the repo exists, with the
 * tracker skill and support in the repo, so the directory grows as ports make
 * progress. Shown from the "Port iOS to your device" button, the Repos tab and
 * each device page (filled in with that phone).
 */
export interface PortPromptInput {
  site: string;
  /** A tracked phone's slug. */
  device?: string;
  /** The phone's name (tracked or not). */
  deviceName?: string;
  /** Codename or model number, for a phone the tracker does not list. */
  model?: string;
  /** Chip, for a phone the tracker does not list. */
  soc?: string;
}

export function portPrompt({ site, device, deviceName, model, soc }: PortPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const name = deviceName?.trim();
  const slug = device?.trim();
  const PHONE = name ? `${name}${model?.trim() ? ` (${model.trim()})` : ""}${soc?.trim() ? `, ${soc.trim()}` : ""}` : "";
  const CLI = `node ~/.local/share/iosonand/cli.mjs`;
  const addRepo = slug
    ? `${CLI} repo-add OWNER/REPO --device ${slug}`
    : name
      ? `${CLI} repo-add OWNER/REPO --new-device ${q(name)}${model?.trim() ? ` --model ${q(model.trim())}` : " --model <codename>"}${soc?.trim() ? ` --soc ${q(soc.trim())}` : ` --soc "<chip>"`} (first check ${CLI} status-get and ${CLI} catalog ${q(name)}: if the tracker lists it, use --device <slug>)`
      : `${CLI} repo-add OWNER/REPO --device <slug> if the tracker lists my phone (${CLI} status-get, ${CLI} references --chip), else ${CLI} repo-add OWNER/REPO --new-device "<phone name>" --model <codename> --soc "<chip>" (it prints the new slug)`;
  const DEV = slug || "<device>";
  return [
    PHONE
      ? `I want to port Apple's iOS to my device: ${PHONE}. Help me research, plan and start it with the iOSOnAnd tracker at ${SITE}. It lists every known iOS-on-Android port, its repos and branches, and what works or is broken on which phone, each with a source.`
      : `I want to port Apple's iOS to my Android device. First ask me which device it is (brand and model). If it is plugged in with USB debugging on, read it yourself: adb shell getprop ro.product.model, ro.product.device (the codename) and ro.soc.model (the chip). Then help me research, plan and start the port with the iOSOnAnd tracker at ${SITE}. It lists every known iOS-on-Android port, its repos and branches, and what works or is broken on which phone, each with a source.`,
    ``,
    `Tools`,
    `1. Read the tracker skill (${SITE}/SKILL.md) and get the tracker CLI outside the repo (Node 18+, no install; reading needs no login; read cli.mjs and note its sha256 before running):`,
    `   mkdir -p ~/.local/share/iosonand && curl -fsSLo ~/.local/share/iosonand/cli.mjs ${SITE}/cli.mjs && sha256sum ~/.local/share/iosonand/cli.mjs && export TRACKER_URL=${SITE}`,
    `   ${CLI} --help lists every command. The HTTP API is described at ${SITE}/api/openapi.json (OpenAPI 3.1) and ${SITE}/api/docs; every GET is public JSON, so use curl when the CLI has no command for something.`,
    ``,
    `Research`,
    `2. Learn the device's hardware. Search the web and the tracker for: exact model number and codename, chip (SoC part number, CPU cores and ARM version), GPU (model and generation), RAM, storage (UFS or eMMC), display panel and touch controller, Wi-Fi/Bluetooth chip, audio codec, modem, whether the bootloader unlocks and supports "fastboot boot" (Samsung uses Odin instead), and whether a Mu-Silicium (Windows on ARM) UEFI port exists.`,
    `   Good sources: the phone's Linux device tree (mainline arch/arm64/boot/dts, postmarketOS wiki, LineageOS device and kernel trees), Mu-Silicium's device list, GSMArena for the basics.`,
    `   ${CLI} catalog "<name>"   codenames and model numbers from Google Play's device list${slug ? `\n   ${CLI} references --device ${slug}   this device on the tracker, and the other phones on its chip` : ""}`,
    `3. Find the existing ports and what works on them:`,
    `   ${CLI} references --chip "<SoC part number, e.g. SM7325>"   and again with the marketing name: the ports on the same or a close chip, their repos and branches, and what works on each. Same chip is best, then the same chip family, then the same GPU.`,
    `   ${CLI} references --gpu "<my GPU, e.g. Adreno 619>"   and again with the family (e.g. "Adreno 6xx", "Mali Valhall"): the phones on the same GPU, GPU work first, each with its GPU areas (metal, gles, gpu), the open driver to read, its repos and sources. Same GPU beats same chip for graphics.`,
    `   ${CLI} porting --codename <codename>   (or porting <slug>, porting --component Adreno740): UniXNU's porting records, as on unixnu.com/devices. Per port repo and area (display, input, gpu, network, audio ...): verified on the device, host-tested, implemented or planned, with the components used. ${CLI} porting-get <record> gives the limits, next step and the exact build and boot commands; ${CLI} components wifi (or adreno, ufs ...) lists the drivers with the boards that run them.`,
    `   ${CLI} status-get --device <slug>   every area of a close port (works, in-progress, broken, unknown) with its detail and source; ${CLI} history <slug> shows what changed and when.`,
    `4. Find GPU acceleration and other parts to reuse, matched to my specs:`,
    `   ${CLI} references --area metal   and --area gles, --area gpu: the phones where Metal or OpenGL ES acceleration works, with the repo, branch and source to read. The same for wifi, audio, touch, battery, modem, camera (${CLI} areas lists the names).`,
    `   Outside the tracker, search GitHub and the web for my exact GPU and chips with "XNU", "IOKit", "kext", "iOS port": other ports' drivers first, then the open Linux driver as the hardware reference (registers, firmware loading, power sequencing). For the GPU that is Mesa and the kernel DRM driver: Adreno (freedreno, Turnip, msm), Mali (Panfrost, PanVK, Panthor), PowerVR (Mesa's powervr driver), Xclipse (RADV/amdgpu).`,
    `   Prefer the same GPU, Wi-Fi or audio chip as mine. Read their commits for that driver and reuse what fits. Check each license before copying: GPL code (most Linux drivers) is a reference unless the port's license allows it. Credit what you reuse.`,
    `   Known graphics failures, so they are not debugged from scratch (compare with ${CLI} references --area metal, --area video-encode):`,
    `   - White widgets or white snapshot placeholders: iOS writes widget and app snapshots as HEIC through CMPhoto, which asks VideoToolbox for a hardware HEVC encoder. With none, CMPhotoCompressionSessionAddImage fails (codec 'hvc1', error -12900) and the widget stays white. The fix that works: publish Apple's own AppleVideoToolboxParavirtualizationDriver service and back it with the phone's hardware encoder (Android MediaCodec), as OneiOS does; iOS 27 also needs VideoToolbox's tile session (ests, epti, etil, ecti). Read akshaynexus/OneiOS kernel/patches/oneios-hosted/codec/README.md and runtime/bridges/encoder (Rust). Record it as the video-encode area.`,
    `   - Black widgets, black blurs and materials, a black lock screen or Notification Center, Earth or dynamic wallpapers missing: a Metal path that fails (a refused heap or function, an unsupported feature or format) draws black. Check the Metal plug-in's log for what it refused, compare with phones where metal works, and keep widgets on the CPU path until Metal covers them (the Pixel 4 port does).`,
    `   - GPU faults, hangs and out-of-memory: recover and log the fault instead of hanging (the Tab S7+ port recovers after GPU faults); heavy wallpapers can run out of GPU memory on 4 GB phones.`,
    `   Check who already hit it: ${CLI} gpu-issues --kind white-widgets (or black-ui, gpu-fault, out-of-memory ...), with their cause and fix.`,
    `   Log each symptom where others can find it: ${CLI} gpu-issue-add ${DEV} "<symptom>" --kind white-widgets|black-ui|gpu-fault|out-of-memory|artifacts|slow|crash|other --cause "<what causes it>" [--fix "<what fixed it>" --state fixed] --source "<log or commit>"; when it is fixed: ${CLI} gpu-issue-set ${DEV} <id> --state fixed --fix "...". Also set the area (metal, gles, gpu, video-encode) with status-set.`,
    `5. Pick the base project. Each one's page (how it boots, what works, its phones and repos) is ${SITE}/?tab=repos&family=<name>, e.g. family=HackiOS:`,
    `   - HackiOS (oosexgang/hakios-xnu-kernel): native XNU; fastboot boot of a Mu-Silicium UEFI and their EFI loader, iOS runs from RAM and nothing is flashed. Best for the Snapdragon 778G (SM7325) family or a phone that has a Mu-Silicium port.`,
    `   - ios-sweet (dipa-studio/ios-sweet): native XNU with a small fastboot-boot shim; the iOS root goes into userdata (erases Android's data). Best for the Snapdragon 730/732G (SM7150) family; most community ports start here.`,
    `   - UniXNU (UniXNU/UniXNU): native XNU through UEFI (UniXNU boot manager, DarwinBoot); iPadOS; tablets and recent high-end Snapdragon.`,
    `   - Open Mapple (open-mapple/manifest): native XNU on MediaTek phones, mtkloader chained into boot; Metal on Mali through Panfrost.`,
    `   - Scion (Scion-Project/scion-kernel): native XNU on Exynos phones from TWRP; iOS 16 and iOS 27 from one kernel tree.`,
    `   - OneiOS (akshaynexus/OneiOS): iOS next to One UI on a rooted Galaxy, not a native boot: a source-built XNU runs as a process on One UI's kernel, and the OneOS app (akshaynexus/OneOS) switches between them. Nothing is flashed.`,
    ``,
    `Plan`,
    `6. Write the plan and show it to me before changing anything: what the research found (closest ports, what works on them, the GPU and driver code that fits), the repo and branch to fork as the base, then the order (memory map and board details, screen, storage, touch and buttons, then GPU acceleration, Wi-Fi, audio from the repos found), each step with the repos, files or commits to follow and the risks (unlocking, wiping data).`,
    `7. Languages: write new code in Rust (boot tools and loaders, UEFI apps with the uefi crate, host and flashing tools, daemons and services, driver logic behind a thin C/C++ shim). Use C or C++ only where Rust can't go: XNU itself, IOKit's C++ interfaces, patches to existing C/C++ code, and vendor ABIs. No Python in anything that ships or runs on the device; Python is fine for small dev scripts.`,
    `   Reuse the Rust tools that exist before writing new ones (both MIT; read their READMEs):`,
    `   - ios-sweet, HackiOS and other UEFI/fastboot ports: akshaynexus/iOSPlus10, tools/op10tool (sparse images img2simg/simg2img, ipsw-get, uefi-unpack, uefi-portpatch for patching a Mu-Silicium UEFI, im4p, boot log capture). Its scripts/ and docs/ show the whole build-and-boot flow on a Snapdragon phone.`,
    `   - Rust code in general: akshaynexus/OneiOS, tools/oneios-tool (one binary, a subcommand per tool: sym for symbolizing panics, log and ioslog for kernel and iOS logs, kernel and prelink for the kernel collection, image and im4p for system images, ios for signing and Mach-O checks, phone for staging over adb) and runtime/ (Rust crates for the loader, display, XNU host and its DRM-to-KGSL GPU bridge, camera and encoder bridges).`,
    `   Fork or vendor the crate you need, keep its license and credit it, and add new tools as subcommands in the same style.`,
    ``,
    `Tracker`,
    `8. As soon as the port's repo exists on GitHub (my fork of the base, under my account), put it on the tracker. Don't wait for it to boot: the device gets a page that fills in as the port makes progress.`,
    `   - sign in with my GitHub account (gh logged in): ${CLI} login`,
    `   - add the repo and the device: ${addRepo}. My GitHub login owns the repo, so the claim is approved at once and I maintain the device.`,
    `   - record the base: ${CLI} repo-lineage OWNER/REPO --base <base OWNER/REPO> --relation fork-of (ported-from when it brings code from another port), and each repo it borrows parts from with --relation uses`,
    `   - mark the areas the plan starts on as in-progress: ${CLI} status-set ${DEV} <area> in-progress --detail "<the plan step>" --source "<repo link>"`,
    `9. In the same first commit, install the tracker skill and set up tracker support in the repo so every later session keeps the page current:`,
    `   - skill: mkdir -p .claude/skills/iosonand-tracker && curl -fsSLo .claude/skills/iosonand-tracker/SKILL.md ${SITE}/SKILL.md`,
    `   - .gitignore: .env, .env.*, cli.mjs, TRACKER_QUEUE.md (the key stays in TRACKER_TOKEN or the CLI's saved login, never in a tracked file)`,
    `   - an "## iOSOnAnd tracker" section in AGENTS.md (and CLAUDE.md / .cursorrules if I use those): this port is at ${SITE}/device/${DEV}; follow the iosonand-tracker skill (.claude/skills/iosonand-tracker/SKILL.md; latest at ${SITE}/SKILL.md) — ask once how tracker updates and release posts should go (auto, ask, off in ~/.config/iosonand/agent-prefs.json), update after a phone boot or release as chosen, always ask and show the file and caption before uploading any image or video, and only claim what a log, capture or pushed doc shows. Also write the language rule from step 7 there.`,
    `   The full version is "Keep the tracker updated from your repo" on ${SITE}/docs/maintain-a-repo.`,
    `10. As the port progresses: follow the iosonand-tracker skill and my preferences in ~/.config/iosonand/agent-prefs.json. After each boot that proves or breaks something, record it with a public --source (commit or pushed boot log); always ask me before uploading any screenshot or clip (--photo, media-upload, or update with files). Uncommon hardware that works: ${CLI} feature-add ${DEV} "<name>" works --detail "..." --source "<link>". Once the GPU draws: ${CLI} gpu-set ${DEV} --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu|other --stack "<chain, e.g. AdrenoMetal -> metal2vulkan -> Turnip>" --fps 40-58 --fps-note "<what was measured>" --repos OWNER/REPO --source "<link>", and update the frame rate as it improves.`,
    ``,
    `Rules: follow ${SITE}/SKILL.md — only claim what a build, log, photo or video shows; anything unproven stays unknown; no personal data or vendor files; never commit API keys; always ask before uploading any image or video, and before anything that wipes or flashes the device.`,
  ].join("\n");
}

/**
 * "Run or improve this port": for someone with this phone who wants to run the
 * existing port, or fork it and keep it going. The agent reads the phone's
 * page through the CLI (what works, history, GPU, issues, porting records),
 * builds and runs the port by its README, and, to improve it, forks the repo,
 * puts the fork on the tracker with the tracker skill and support in it, and
 * records progress as it goes. Shown in the Repos section of a phone's page.
 */
export function continuePrompt({
  site,
  device,
  deviceName,
  repo,
  soc,
  gpu,
}: {
  site: string;
  device: string;
  deviceName: string;
  repo?: string;
  soc?: string;
  gpu?: string;
}): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<the port's repo>";
  const CLI = "node ~/.local/share/iosonand/cli.mjs";
  const hw = [soc, gpu].filter(Boolean).join(", ");
  return [
    `I have a ${deviceName}${hw ? ` (${hw})` : ""} and want to run the iOS port that exists for it, then help improve it. The port is ${REPO}; the iOSOnAnd tracker at ${SITE}/device/${device} lists what works on it, with sources.`,
    ``,
    `Tools`,
    `1. Read the tracker skill (${SITE}/SKILL.md) and get the tracker CLI outside the repo (Node 18+, no install; reading needs no login; read cli.mjs and note its sha256 before running):`,
    `   mkdir -p ~/.local/share/iosonand && curl -fsSLo ~/.local/share/iosonand/cli.mjs ${SITE}/cli.mjs && sha256sum ~/.local/share/iosonand/cli.mjs && export TRACKER_URL=${SITE}`,
    `   The HTTP API is described at ${SITE}/api/openapi.json; every GET is public JSON.`,
    ``,
    `Know where the port stands`,
    `2. Read the phone's page: ${CLI} status-get --device ${device} (every area: works, in progress, broken, unknown, with detail and source), ${CLI} history ${device} (what changed lately), ${CLI} gpu-get ${device} (how GPU acceleration works, the frame rate, known GPU issues), ${CLI} porting ${device} (porting records per repo: verified on device, implemented, planned, with build steps), ${CLI} features ${device}.`,
    `   Then read ${REPO}: its README, docs, open issues and recent commits. Check the exact model: the port may need a specific variant, firmware or bootloader state.`,
    `3. Tell me what works, what does not, what is risky (unlocking, erasing data, flashing) and what I need (a PC or Mac, tools, files), before changing anything.`,
    ``,
    `Run it`,
    `4. Build and boot it exactly as the README says, step by step, asking me before anything that unlocks, erases or flashes the phone. Keep the logs.`,
    `5. If it works or fails differently from what the tracker says, tell me; once I agree, record it (sign in first: ${CLI} login, a gist proves my GitHub account; or an API key in TRACKER_TOKEN). Always ask before uploading any screenshot or clip. If I am not a maintainer of this phone yet, the write answers 403: then open an issue on ${REPO} with the logs instead, or carry on with step 6.`,
    ``,
    `Improve it (when I want to work on it)`,
    `6. Fork it under my account and keep the original as upstream: gh repo fork ${REPO} --clone && git remote -v. Sync with upstream before each piece of work.`,
    `7. Put the fork on the tracker for this phone and say where it comes from: ${CLI} repo-add <MY_FORK> --device ${device}, then ${CLI} repo-lineage <MY_FORK> --base ${REPO} --relation fork-of. My GitHub login owns the fork, so the claim is approved at once; never commit a verification code to the main branch.`,
    `8. In the first commit, install the tracker skill and set up tracker support in the fork: mkdir -p .claude/skills/iosonand-tracker && curl -fsSLo .claude/skills/iosonand-tracker/SKILL.md ${SITE}/SKILL.md; .gitignore (.env, .env.*, cli.mjs, TRACKER_QUEUE.md); and an "## iOSOnAnd tracker" section in AGENTS.md (and CLAUDE.md / .cursorrules if I use those) pointing to ${SITE}/device/${device} and the iosonand-tracker skill (.claude/skills/iosonand-tracker/SKILL.md; latest at ${SITE}/SKILL.md) — ask once how tracker updates and release posts should go (auto, ask, off in ~/.config/iosonand/agent-prefs.json), update after a phone boot or release as chosen, always ask before uploading any image or video, and only claim what a log, capture or pushed doc shows. Full version: ${SITE}/docs/maintain-a-repo.`,
    `9. Pick what to improve from the tracker: areas that are broken, in progress or unknown, open GPU issues (${CLI} gpu-issues --device ${device}), and planned areas in the porting records. For each, look for working code first: ${CLI} references --area <area> and ${CLI} references --gpu "${gpu || "<GPU>"}" (same chip or GPU on other phones), ${CLI} components <words> (framework drivers and the boards using them). Reuse what fits, keep licenses and credit it.`,
    `10. Write new code in Rust where it can go (tools, loaders, daemons, driver logic behind a thin C/C++ shim); C or C++ only for XNU, IOKit's C++ interfaces, existing C code and vendor ABIs; Python only for small dev scripts.`,
    `11. Follow the iosonand-tracker skill and my ~/.config/iosonand/agent-prefs.json preferences: after each boot that shows a result, record it on the tracker with a public commit or doc as --source (always ask before uploading images or videos). When a fix works on the phone, offer to open a pull request back to ${REPO} (ask me first; follow its contributing rules).`,
    ``,
    `Rules: follow ${SITE}/SKILL.md — only claim what a build, log, photo or video shows; anything unproven stays unknown; no personal data or vendor files; never commit API keys; always ask before uploading any image or video, and before anything that wipes, unlocks or flashes the phone.`,
  ].join("\n");
}
