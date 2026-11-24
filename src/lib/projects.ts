// src/lib/projects.ts — the projects iOS-on-Android ports start from, for the
// projects on the Repos tab. Facts come from each project's README and docs and from
// hackiosx.dev (the `sources` of each); the counts on the page come from the
// tracker's own data (`family` = forks.base_project).

export interface Project {
  /** Anchor on the page. */
  id: string;
  name: string;
  /** The base_project label its repos carry on the tracker. */
  family: string;
  /** How it runs, in a few words ("Native XNU boot"). */
  kind: string;
  /** What installing it costs Android, in a few words. */
  install: string;
  /** One sentence: what it is. */
  summary: string;
  repos: string[];
  docs?: string;
  /** The phone it was built for, with its chip. */
  reference: string;
  /** What runs: iOS/iPadOS version and firmware. */
  runs: string;
  /** How it starts: boot chain, where the system lives, what it costs Android. */
  boot: string;
  works: string[];
  missing: string[];
  startAPort: string;
  sources: string[];
}

export const PROJECTS: Project[] = [
  {
    "id": "oneios",
    "kind": "Runs next to One UI",
    "install": "Needs root; nothing flashed, Android stays",
    "name": "OneiOS",
    "family": "OneiOS",
    "summary": "iOS next to One UI on a rooted Galaxy: a source-built XNU runs as a process on One UI's own kernel, and the OneOS app switches the phone between the two.",
    "repos": [
      "akshaynexus/OneiOS",
      "akshaynexus/OneOS"
    ],
    "docs": "https://github.com/akshaynexus/OneiOS/tree/main/docs",
    "reference": "Galaxy S24 Ultra (SM-S928), rooted with KernelSU; Snapdragon 8 Gen 3 (SM8650)",
    "runs": "iOS 27.0.1 (24A446) from the iPhone18,2 IPSW, Apple's binaries unchanged, on XNU 12377",
    "boot": "Nothing is flashed: the images live in a folder. The OneOS app (akshaynexus/OneOS, a fork of fahadalijaved/OneOS) stops One UI's framework and starts iOS; a key chord returns to One UI. Needs root; Android's data stays.",
    "works": [
      "Home Screen, lock screen and swipe unlock",
      "GPU compositing (40-58 fps on the idle lock screen)",
      "Touch, buttons, keyboard, S Pen",
      "Battery readings, Wi-Fi join and DHCP",
      "Sound and volume keys, keyboard haptics, HEVC encode",
      "Return to One UI"
    ],
    "missing": [
      "Lag in app launches and Control Center (fixes merged, not yet booted)",
      "Camera preview is black (fixed on main, not yet booted)",
      "Auto-brightness readings",
      "Not goals: passcode, Face ID, Wallet, calls, SMS"
    ],
    "startAPort": "Don't fork for a new Galaxy: add the phone to the host device table (runtime/bridges/hw/host_device.rs), a host profile and a device record (docs/s25.md is the template), prove its backend against the stand-in tests, and run scripts/port/verify-host.sh. The S25, S25 Ultra, S26 Ultra and A56 forks are listed in docs/forks.md.",
    "sources": [
      "https://github.com/akshaynexus/OneiOS",
      "https://github.com/akshaynexus/OneiOS/blob/main/docs/architecture.md",
      "https://github.com/akshaynexus/OneiOS/blob/main/docs/forks.md"
    ]
  },
  {
    "id": "hackios",
    "kind": "Native XNU boot",
    "install": "Sent to RAM over USB; nothing flashed",
    "name": "HackiOS",
    "family": "HackiOS",
    "summary": "Native XNU on the phone with its own EFI loader and drivers: Wi-Fi through Linux's ath11k on a LinuxKPI layer, the GPU through Mesa freedreno, Metal in progress.",
    "repos": [
      "oosexgang/hakios-xnu-kernel",
      "oosexgang/hakios-uefi",
      "oosexgang/hakios-metal"
    ],
    "docs": "https://github.com/oosexgang/hakios-xnu-kernel/tree/main/Documentation",
    "reference": "POCO X5 Pro 5G (redwood), Snapdragon 778G (SM7325); the current README targets the Xiaomi Mi 11 Lite 5G (renoir, Snapdragon 780G)",
    "runs": "iOS 16.5 on xnu-8796 (redwood, per hackiosx.dev); Darwin 26.6.2 and 27.2 from iPhone 11 files on xnu-12377, software-drawn (renoir, per the README)",
    "boot": "fastboot boot of a Mu-Silicium UEFI port (or Redwood U-Boot) that starts their EFI loader, then XNU. The system image is sent into RAM over USB for each session: nothing is flashed or erased, and a reboot gives the phone back to Android.",
    "works": [
      "Lock and home screen, gestures, Control Center, widgets (redwood)",
      "Stock apps: Settings, Photos, Safari",
      "Multitouch, power and volume keys; all 8 cores",
      "Adreno 642L GPU draws the interface",
      "Wi-Fi with Safari; speakers, microphone, front and rear camera",
      "Sileo, Procursus and SSH"
    ],
    "missing": [
      "Cellular and Bluetooth",
      "Charging while iOS runs",
      "Metal for apps",
      "App Store and Apple ID",
      "Video recording"
    ],
    "startAPort": "Needs a Qualcomm phone with an unlockable bootloader and a Mu-Silicium UEFI port. Run tools/boards.py new NAME --soc ... --dts with the live device tree, fill in clock offsets and the I/O window, apply the Mu-Silicium patch, and boot display-only on one core first (BENCH_DEFCONFIG=phone_first); then turn features on one at a time (Documentation/porting.md). Best for the SM7325 family.",
    "sources": [
      "https://github.com/oosexgang/hakios-xnu-kernel",
      "https://github.com/oosexgang/hakios-xnu-kernel/blob/main/Documentation/porting.md",
      "https://hackiosx.dev/projects"
    ]
  },
  {
    "id": "ios-sweet",
    "kind": "Native XNU boot",
    "install": "Flashes userdata; erases Android's data",
    "name": "ios-sweet",
    "family": "ios-sweet",
    "summary": "Native XNU with a small boot shim standing in for iBoot and drivers written as kernel patches; the CPU draws everything. Most community ports started here.",
    "repos": [
      "dipa-studio/ios-sweet"
    ],
        "reference": "Redmi Note 10 Pro (sweet), Snapdragon 732G (SM7150)",
    "runs": "iOS 16.7.16 (20H392), the unmodified iPhone X userland, on xnu-8796",
    "boot": "The unlocked stock bootloader runs fastboot boot shim-boot.img, which starts XNU; nothing goes to the boot partitions. The iOS root is an HFS+ image flashed to userdata, which erases Android's data. Power + Volume down returns to fastboot.",
    "works": [
      "Lock and home screen (about 4 minutes on the Apple logo)",
      "Settings, Control Center, notification center",
      "Goodix touch, power and volume keys, lock and wake",
      "Read/write UFS storage, offline activation"
    ],
    "missing": [
      "Wi-Fi, Bluetooth, cellular",
      "Audio, camera, sensors, GPS, Face ID",
      "GPU: the CPU draws at 20-30 fps",
      "Real battery level (shows 100 %)",
      "App Store and Apple ID"
    ],
    "startAPort": "Fork it (the kernel builds on GitHub's macOS runners: gh workflow run xnu.yml). Change the hardware description in tools/mkadt.py and a few addresses in the shim, then the board patches: keys and touch (0060-0063), screen size (0061), early screen address (0010/0012), USB (0072-0077). On the same SM7150 chip the kernel mostly works as is.",
    "sources": [
      "https://github.com/dipa-studio/ios-sweet",
      "https://hackiosx.dev/porting",
      "https://hackiosx.dev/compatibility"
    ]
  },
  {
    "id": "unixnu",
    "kind": "Native XNU through UEFI",
    "install": "Flashes userdata; erases Android's data",
    "name": "UniXNU",
    "family": "UniXNU",
    "summary": "Native XNU through a general UEFI environment, like OpenCore: a Mu-Silicium UEFI per device starts the UniXNU boot manager, which hands off to the DarwinBoot loader. Shared code, SoC repos, device repos and one repo per driver.",
    "repos": [
      "UniXNU/UniXNU",
      "UniXNU/DarwinBoot",
      "UniXNU/UniXNU-sheng"
    ],
    "docs": "https://unixnu.com",
    "reference": "Xiaomi Pad 6S Pro 12.4 (sheng), Snapdragon 8 Gen 2 (SM8550), Adreno 740",
    "runs": "iPadOS 27.0.1 (24A446) by default on sheng, with profiles for iPadOS 17 and 26 and macOS 27.3; hackiosx.dev describes the earlier iPadOS 17 setup",
    "boot": "An Android boot image (BootShim, UEFI, device tree, payload) started with fastboot boot, then UEFI, UniXNU.efi, DarwinBoot and XNU. The OS images go to userdata with fastboot flash userdata.",
    "works": [
      "iPadOS home screen and Settings",
      "Native Adreno 740 kernel driver with Metal (AdrenoMetal)",
      "Touch, display, UFS storage",
      "Keyboard cover, Bluetooth (AirPods), USB pairing with a Mac (sheng page)",
      "Wi-Fi scan, WPA2 join and DHCP (sheng page)"
    ],
    "missing": [
      "Audio, camera, sensors, battery driver, sleep and wake (hackiosx.dev, may be older)",
      "An arm64e profile is planned"
    ],
    "startAPort": "Follow Port a device on unixnu.com/porting: a device repository (board.toml, porting.toml, device tree, XNU patch series) that picks a SoC repository, plus a uefi-<device> Mu-Silicium fork; build with the ./unixnu CLI. unixnu.com/devices lists about 100 community device records. Best for tablets and recent high-end Snapdragon.",
    "sources": [
      "https://github.com/UniXNU/UniXNU",
      "https://unixnu.com/porting/",
      "https://unixnu.com/devices/sheng"
    ]
  },
  {
    "id": "open-mapple",
    "kind": "Native XNU on MediaTek",
    "install": "Flashes userdata; SplitBoot can keep Android",
    "name": "Open Mapple",
    "family": "Open Mapple",
    "summary": "Native XNU on MediaTek phones with its own drivers, built like a custom ROM from a repo manifest; it builds on HakiOS, ios-sweet and ios-viva.",
    "repos": [
      "open-mapple/manifest",
      "open-mapple/mapple_loader",
      "open-mapple/mapple_gpu_mali"
    ],
    "docs": "https://open-mapple.pages.dev/docs/",
    "reference": "realme 8i (spaced), MediaTek Helio G96 (MT6781), Mali-G57",
    "runs": "iOS 16.7.16 (20H392) presented as an iPhone X, on xnu-8796.141.3",
    "boot": "LK loads boot, where mtkloader is chained in front of Android's kernel; mtkloader starts the shim, which starts XNU. The iOS root goes on with fastboot flash userdata (erases Android's data), then a recovery zip chains the loader into boot. Optional SplitBoot keeps Android with a boot menu. Hold Volume Down at boot for safe boot.",
    "works": [
      "Metal draws the interface on the Mali GPU (Panfrost)",
      "Wi-Fi; Bluetooth headphones and keyboards",
      "Speaker, microphone, vibration",
      "Passcode and safe boot, rotation",
      "Mapple app: settings, IPA sideload, tweaks"
    ],
    "missing": [
      "Camera",
      "Cellular",
      "Automatic brightness",
      "Qualcomm phones are build-only"
    ],
    "startAPort": "For a MediaTek phone: unlocked bootloader, root, backups of boot, lk and the partition table. Run bringup.py from mapple_device_setup_scripts with the live device tree and the Android device and kernel trees, check out/BRIEF.md against the phone, then bring things up one boot argument at a time (open-mapple.pages.dev/docs/guides/porting).",
    "sources": [
      "https://github.com/open-mapple/manifest",
      "https://open-mapple.pages.dev/docs/concepts/architecture/",
      "https://open-mapple.pages.dev/docs/guides/porting/"
    ]
  },
  {
    "id": "scion",
    "kind": "Native XNU on Exynos",
    "install": "Flashed from TWRP; replaces Android",
    "name": "Scion",
    "family": "Scion",
    "summary": "Native XNU on Exynos phones with its own drivers, from a fork of the HakiOS kernel; one kernel tree covers both xnu-8796 (iOS 16) and xnu-12377 (iOS 27).",
    "repos": [
      "Scion-Project/scion-kernel",
      "Scion-Project/scion-installer"
    ],
    "docs": "https://scion-project.github.io",
    "reference": "Galaxy S9 (SM-G960F, starlte), Exynos 9810, Mali-G72",
    "runs": "iOS 16.5 (20F66, iPhone X IPSW) on xnu-8796 and iOS 27.0.1 (24A446, iPhone 11 IPSW) on xnu-12377",
    "boot": "iOS 16.5: a TWRP zip you build writes the boot image to BOOT and the system to SYSTEM, replacing Android's system. iOS 27: BOOT and USERDATA written from TWRP, which erases Android's data. Needs an unlocked bootloader and TWRP; five fingers for 1.5 s restarts into TWRP.",
    "works": [
      "iOS 16.5: 8 cores, touch, GPU (OpenGL ES via Panfrost)",
      "Wi-Fi, speakers, microphone, front camera",
      "Bluetooth, sensors, vibration, battery",
      "iOS 27: home screen, touch, storage; Metal with Liquid Glass via PanVK"
    ],
    "missing": [
      "Calls and SMS",
      "Rear cameras, headphones",
      "App Store, Apple ID, iCloud (not a goal)",
      "iOS 27 can hang; no Secure Enclave or file encryption",
      "Snapdragon S9 models"
    ],
    "startAPort": "Clone scion-kernel and run tools/hakios-device.py new mydevice --soc ... --fdt device-tree.dtb, then make mydevice_defconfig, make kernel, make loader and make phone SECS=120 until a run reaches launchd; add drivers one at a time (CPUFREQ, THERMAL, SOCINFO, then buttons and touch).",
    "sources": [
      "https://github.com/Scion-Project/scion-kernel",
      "https://github.com/Scion-Project/scion-kernel/blob/main/docs/ios27/INSTALL-S9.md",
      "https://scion-project.github.io"
    ]
  }
];
