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
    `1. Get the tracker CLI (Node 18+, no install): curl -fsSLo cli.mjs ${SITE}/cli.mjs`,
    `2. Sign in with my GitHub account (needs the gh CLI, logged in): TRACKER_URL=${SITE} node cli.mjs login`,
    ...findRepo,
    ...findPhone,
    fresh
      ? `3. Claim the repo and add the phone, which the tracker does not list yet: node cli.mjs repo-add ${REPO} --new-device ${q(fresh.name.trim())}${fresh.model?.trim() ? ` --model ${q(fresh.model.trim())}` : ""}${fresh.soc?.trim() ? ` --soc ${q(fresh.soc.trim())}` : ""}. It prints the new phone's slug: use it as <device> below.`
      : `3. Claim the repo: node cli.mjs repo-claim ${REPO} --device ${DEVICE}`,
    `   If it prints a verification code, write that code alone to .iosonand-verify on the repo's default branch, push, run node cli.mjs repo-verify <claim id>, then delete the file.`,
    `4. Read the repo (README, issues, recent commits) and record what works on the phone, one area at a time:`,
    `   node cli.mjs areas`,
    `   node cli.mjs status-set ${DEVICE} <area> works|in-progress|broken --detail "<what I can show>" --source "<link>"`,
    `   Say which system it is on: --os ios (the default; iPadOS too), --os macos or --os tvos, with --version "<e.g. iOS 27.2>".`,
    `   Only claim what the repo or I can show. Ask me when unsure.`,
    `   Something the areas don't cover, or uncommon hardware that works (an IR blaster, a stylus, a second screen): node cli.mjs feature-add ${DEVICE} "<name>" works --detail "..." --source "<link>"`,
    `   A GPU problem you can name (white widgets, black blurs, GPU faults, out of memory): node cli.mjs gpu-issue-add ${DEVICE} "<symptom>" --kind white-widgets|black-ui|gpu-fault|out-of-memory|artifacts|slow|crash|other --cause "<what causes it>" [--fix "<what fixed it>" --state fixed] --source "<log or commit>"`,
    `   How the GPU acceleration works and how fast, when the repo or I can show it: node cli.mjs gpu-set ${DEVICE} --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu --stack "<chain, e.g. AdrenoMetal -> metal2vulkan -> Turnip>" --fps 40-58 --fps-note "<what was measured>" --repos OWNER/REPO --source "<link>"`,
    `5. Attach proof when I give you screenshots or clips: add --photo <file> (repeatable) to the status-set or feature-add it proves, so the photo is linked to that change; or node cli.mjs media-upload <file> --device ${DEVICE} --area <area> --caption "..."`,
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
    `   - with screenshots or clips: add --photo <file> (repeatable) to the status-set or feature-add they prove, so they are linked to it; a general progress post: <CLI> update ${DEVICE} <files...> --text "<what changed>"`,
    `   - a GPU issue (white widgets, black blurs, GPU faults ...): <CLI> gpu-issue-add ${DEVICE} "<symptom>" --kind white-widgets|black-ui|gpu-fault|out-of-memory|artifacts|slow|crash|other --cause "<what causes it>" [--fix "<what fixed it>" --state fixed] --source "<log or commit>"; mark it fixed with gpu-issue-set ${DEVICE} <id> --state fixed --fix "..."`,
    `   - GPU acceleration: how it works and the frame rate measured, <CLI> gpu-set ${DEVICE} --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu --stack "<chain, e.g. AdrenoMetal -> metal2vulkan -> Turnip>" --fps 40-58 --fps-note "<what was measured>" --repos OWNER/REPO --source "<link>"`,
    `   - only record what a build, log, test or capture shows; anything unproven stays unknown`,
    `   - the key comes from TRACKER_TOKEN or the CLI's saved login, never from a file in this repo`,
    `   - tracker unreachable: <CLI> queue status-set ..., then <CLI> flush later`,
    ``,
    `5. Commit only the instructions file and .gitignore. Check git status first: no key, no .env, no cli.mjs.`,
    `6. First sync: read the README, issues and recent commits, compare with status-get, and record what they show (ask me when unsure).`,
  ].join("\n");
}

/**
 * "Port iOS to your device": the prompt that has a coding agent use the
 * tracker (CLI or API, reads need no login) to find the existing ports for the
 * phone or its chip and what works on them, find GPU acceleration and other
 * driver code that fits its specs, pick the base project, and plan the port
 * (Rust first, C/C++ only where needed) before changing anything. Then it puts
 * the new repo and phone on the tracker as soon as the repo exists, with
 * tracker support in the repo, so the directory grows as ports make progress.
 * Shown from the "Port iOS to your device" button, the Repos tab and each
 * device page (filled in with that phone).
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
  const CLI = `node cli.mjs`;
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
    `1. The tracker CLI (Node 18+, no install; reading needs no login): curl -fsSLo cli.mjs ${SITE}/cli.mjs && export TRACKER_URL=${SITE}`,
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
    `9. In the same first commit, set up tracker support in the repo so every later session keeps the page current:`,
    `   - .gitignore: .env, .env.*, cli.mjs, TRACKER_QUEUE.md (the key stays in TRACKER_TOKEN or the CLI's saved login, never in a tracked file)`,
    `   - an "## iOSOnAnd tracker" section in AGENTS.md (and CLAUDE.md / .cursorrules if I use those): this port is at ${SITE}/device/${DEV}; when a change makes an area work or breaks it, read status-get, then record it in the same session with status-set ${DEV} <area> works|in-progress|broken --detail "<what the build, log or test showed>" --source "<commit or log link>", with --os ios|macos|tvos and --version, and --photo <file> for a screenshot or clip that proves it; progress posts with update ${DEV} <files> --text "..."; unproven stays unknown. Also write the language rule from step 7 there.`,
    `   The full version is "Keep the tracker updated from your repo" on ${SITE}/docs/maintain-a-repo.`,
    `10. As the port progresses: each time a step boots or a part works, record it (works, or broken with what failed) in that session, with the commit as --source and --photo for a screenshot or clip I give you. Uncommon hardware that works: ${CLI} feature-add ${DEV} "<name>" works --detail "..." --source "<link>" [--photo <file>]. Once the GPU draws: ${CLI} gpu-set ${DEV} --method native-metal|metal-vulkan|metal-gl|gles|virtio-gpu|cpu --stack "<chain, e.g. AdrenoMetal -> metal2vulkan -> Turnip>" --fps 40-58 --fps-note "<what was measured>" --repos OWNER/REPO --source "<link>", and update the frame rate as it improves.`,
    ``,
    `Rules: only claim what a build, log, photo or video shows; anything unproven stays unknown. Never commit API keys. Ask me before anything that wipes or flashes the device.`,
  ].join("\n");
}
