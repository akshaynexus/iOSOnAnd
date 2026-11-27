/**
 * src/lib/gpu.ts: a phone's GPU, from its chip, so ports can be matched by GPU
 * and not only by chip ("who has GPU work on an Adreno 6xx?").
 *
 * A device's `gpu` column (migration 0017) wins when a maintainer or an admin
 * set it; otherwise the GPU comes from the chip through SOC_GPU below. Each
 * GPU has a family (the generation open drivers group by) and the open
 * driver whose code is the hardware reference for that family.
 *
 * The table covers the chips the tracker lists; a chip it does not know gives
 * '' (unknown), never a guess. Add rows here when new chips show up.
 */

/** [pattern on the chip text (marketing name or part number), GPU]. First match wins. */
const SOC_GPU: Array<[RegExp, string]> = [
  // Qualcomm Snapdragon (part numbers first: they are exact)
  [/\bSM8850\b|8 Elite Gen 5/i, 'Adreno 840'],
  [/\bSM8845\b|8 Gen 5\b/i, 'Adreno 829'],
  [/\bSM8750\b|8 Elite\b/i, 'Adreno 830'],
  [/\bSM8735\b|8s Gen 4/i, 'Adreno 825'],
  [/\bSM8650\b|8 Gen 3/i, 'Adreno 750'],
  [/\bSM8635\b|8s Gen 3/i, 'Adreno 735'],
  [/\bSM8550\b|8 Gen 2/i, 'Adreno 740'],
  [/\bSM8475\b|8\+ Gen 1/i, 'Adreno 730'],
  [/\bSM8450\b|8 Gen 1/i, 'Adreno 730'],
  [/\bSM8350\b|Snapdragon 888/i, 'Adreno 660'],
  [/\bSM8250\b|Snapdragon 865|Snapdragon 870/i, 'Adreno 650'],
  [/\bSM8150\b|Snapdragon 855|Snapdragon 860/i, 'Adreno 640'],
  [/\bSDM845\b|Snapdragon 845/i, 'Adreno 630'],
  [/\bMSM8998\b|Snapdragon 835/i, 'Adreno 540'],
  [/\bMSM8996\b|Snapdragon 82[01]/i, 'Adreno 530'],
  [/\bMSM8994\b|Snapdragon 810/i, 'Adreno 430'],
  [/\bSM7675\b|7\+ Gen 3/i, 'Adreno 732'],
  [/\bSM7475\b|7\+ Gen 2/i, 'Adreno 725'],
  [/\bSM7435\b|7s Gen 2/i, 'Adreno 710'],
  [/\bSM7635\b|7s Gen 3/i, 'Adreno 810'],
  [/\bSM6475\b|Snapdragon 6 Gen 3/i, 'Adreno 710'],
  [/\bSM7350\b|Snapdragon 780G/i, 'Adreno 642'],
  [/\bSM7325\b|Snapdragon 77[86]G|Snapdragon 782G/i, 'Adreno 642L'],
  [/\bSM7250\b|Snapdragon 76[05]/i, 'Adreno 620'],
  [/\bSM7150\b|Snapdragon 73[02]/i, 'Adreno 618'],
  [/\bSM7125\b|Snapdragon 720G/i, 'Adreno 618'],
  [/\bSM7225\b|Snapdragon 750G/i, 'Adreno 619'],
  [/\bSM6375\b|Snapdragon 695|6s Gen 3/i, 'Adreno 619'],
  [/\bSDM670\b|Snapdragon 670/i, 'Adreno 615'],
  [/\bSDM71[02]\b|Snapdragon 71[02]/i, 'Adreno 616'],
  [/\bSDM660\b|Snapdragon 660/i, 'Adreno 512'],
  [/\bSM6225\b|Snapdragon 68[05]/i, 'Adreno 610'],
  [/\bSM6125\b|Snapdragon 665/i, 'Adreno 610'],
  [/\bSM6115\b|Snapdragon 662/i, 'Adreno 610'],
  [/\bSM4250\b|Snapdragon 460/i, 'Adreno 610'],
  [/\bSDM636\b|Snapdragon 636/i, 'Adreno 509'],
  [/\bMSM8953\b|Snapdragon 625/i, 'Adreno 506'],
  [/\bMSM8940\b|Snapdragon 435/i, 'Adreno 505'],
  [/\bMSM8937\b|Snapdragon 430/i, 'Adreno 505'],
  [/\bSDM429\b|Snapdragon 429/i, 'Adreno 504'],
  [/\bMSM8956\b|Snapdragon 650/i, 'Adreno 510'],
  [/\bMSM8939\b|Snapdragon 616/i, 'Adreno 405'],
  [/\bMSM8916\b|Snapdragon 410/i, 'Adreno 306'],
  // Google Tensor
  [/\bGS101\b|Tensor G1\b/i, 'Mali-G78 MP20'],
  [/\bGS201\b|Tensor G2\b/i, 'Mali-G710 MP7'],
  [/\bzuma\b|Tensor G3\b/i, 'Mali-G715 MC10'],
  [/Tensor G4\b/i, 'Mali-G715 MC7'],
  [/Tensor G5\b/i, 'PowerVR DXT-48-1536'],
  // Samsung Exynos
  [/Exynos 2400/i, 'Xclipse 940'],
  [/Exynos 2200/i, 'Xclipse 920'],
  [/Exynos 1580/i, 'Xclipse 540'],
  [/Exynos 2100/i, 'Mali-G78 MP14'],
  [/Exynos 990/i, 'Mali-G77 MP11'],
  [/Exynos 982[05]/i, 'Mali-G76 MP12'],
  [/Exynos 9810/i, 'Mali-G72 MP18'],
  [/Exynos 9611/i, 'Mali-G72 MP3'],
  [/Exynos 8895/i, 'Mali-G71 MP20'],
  [/Exynos 8890/i, 'Mali-T880 MP12'],
  [/Exynos 7904/i, 'Mali-G71 MP2'],
  [/Exynos 7870/i, 'Mali-T830 MP1'],
  [/Exynos 7580/i, 'Mali-T720 MP2'],
  [/Exynos 7570/i, 'Mali-T720 MP1'],
  [/Exynos 7420/i, 'Mali-T760 MP8'],
  [/Exynos 1280/i, 'Mali-G68 MP4'],
  [/Exynos 850\b/i, 'Mali-G52 MP1'],
  [/Exynos 4210/i, 'Mali-400 MP4'],
  // MediaTek Dimensity and Helio (part numbers where the name is shared)
  [/\bMT6993\b|Dimensity 9500/i, 'Mali-G1-Ultra MC12'],
  [/\bMT6991\b|Dimensity 9400/i, 'Immortalis-G925 MC12'],
  [/\bMT6989\b|Dimensity 9300/i, 'Immortalis-G720 MC12'],
  [/\bMT6878\b|Dimensity 7300/i, 'Mali-G615 MC2'],
  [/\bMT6899\b|Dimensity 8400/i, 'Mali-G720 MC7'],
  [/\bMT6897\b|Dimensity 8300/i, 'Mali-G615 MC6'],
  [/\bMT6893\b|Dimensity 8050|Dimensity 1200|Dimensity 1100/i, 'Mali-G77 MC9'],
  [/Dimensity 1080/i, 'Mali-G68 MC4'],
  [/\bMT6853\b|Dimensity 800U|Dimensity 720/i, 'Mali-G57 MC3'],
  [/\bMT6833\b|Dimensity 700|Dimensity 6080|Dimensity 6020/i, 'Mali-G57 MC2'],
  [/\bMT6789\b|Helio G99|Helio G100/i, 'Mali-G57 MC2'],
  [/\bMT6835\b|Dimensity 6300/i, 'Mali-G57 MC2'],
  [/\bMT6781\b|Helio G96/i, 'Mali-G57 MC2'],
  [/\bMT6785\b|Helio G9[05]T?\b/i, 'Mali-G76 MC4'],
  [/\bMT676[89]|Helio G8[0158]|Helio G70|Helio P65/i, 'Mali-G52 MC2'],
  [/\bMT6765\b|\bMT8768\b|Helio G3[57]|Helio P35|Helio P22/i, 'PowerVR GE8320'],
  [/\bMT8163\b/i, 'Mali-T720 MP2'],
  // Unisoc
  [/\bUMS512\b|Unisoc T618/i, 'Mali-G52 MP2'],
  [/\bUMS9230\b|Unisoc T606/i, 'Mali-G57 MP1'],
  // NVIDIA Tegra (the Nintendo Switch)
  [/\bT210(B01)?\b|Tegra X1/i, 'Maxwell GM20B'],
  // Others
  [/S905X5/i, 'Mali-G310 V2'],
];

export interface GpuInfo {
  /** The GPU, e.g. "Adreno 619"; '' when unknown. */
  gpu: string;
  /** 'device' when the device row names it, 'chip' when it comes from the chip, '' when unknown. */
  gpu_source: 'device' | 'chip' | '';
  /** The generation open drivers group by, e.g. "Adreno 6xx", "Mali Valhall"; '' when unknown. */
  gpu_family: string;
  /** The open driver whose code is the hardware reference for that family, e.g. "freedreno / Turnip (msm)". */
  gpu_driver: string;
}

/** The GPU of a chip (marketing name or part number), or '' when the table does not know it. */
export function gpuOfSoc(soc: string | null | undefined): string {
  const s = (soc ?? '').trim();
  if (!s) return '';
  for (const [re, gpu] of SOC_GPU) if (re.test(s)) return gpu;
  return '';
}

/** Mali generations by model (Arm's architecture names; Panfrost covers up to Valhall JM, Panthor the CSF parts). */
const MALI: Array<[RegExp, string, string]> = [
  [/Mali-(400|450)/i, 'Mali Utgard', 'Lima'],
  [/Mali-T\d/i, 'Mali Midgard', 'Panfrost'],
  [/Mali-G(31|51|52|71|72|76)\b/i, 'Mali Bifrost', 'Panfrost'],
  [/Mali-G(57|68|77|78)\b/i, 'Mali Valhall (JM)', 'Panfrost'],
  [/Mali-G(310|510|610|710|615|715)\b/i, 'Mali Valhall (CSF)', 'Panthor'],
  [/Mali-G(720|620|925|725)\b|Mali-G1/i, 'Mali 5th gen and later', 'Panthor'],
];

/** The family and open driver of a GPU name. */
export function gpuFamily(gpu: string): { family: string; driver: string } {
  const g = gpu.trim();
  let m = /Adreno\s*(\d)(\d)\d/i.exec(g);
  if (m) {
    const gen = Number(m[1]);
    return { family: `Adreno ${gen}xx`, driver: gen >= 6 ? 'freedreno / Turnip (msm)' : 'freedreno (msm)' };
  }
  if (/Mali|Immortalis/i.test(g)) {
    const mali = g.replace(/Immortalis-/i, 'Mali-');
    for (const [re, family, driver] of MALI) if (re.test(mali)) return { family, driver };
    return { family: 'Mali', driver: 'Panfrost / Panthor' };
  }
  if (/PowerVR\s*(GE|GX|GT|GM|AXE|BXM|BXE)/i.test(g)) return { family: 'PowerVR Rogue', driver: 'Mesa powervr (imagination; Rogue support is partial)' };
  if (/PowerVR\s*DXT/i.test(g)) return { family: 'PowerVR D-Series', driver: 'Mesa powervr (imagination)' };
  if (/Maxwell|GM20B/i.test(g)) return { family: 'NVIDIA Maxwell', driver: 'nouveau / NVK (Mesa)' };
  if (/Xclipse/i.test(g)) return { family: 'Xclipse (AMD RDNA)', driver: 'RADV / amdgpu (reference only)' };
  return { family: '', driver: '' };
}

/** A device's GPU: its own `gpu` field when set, else from its chip. */
export function gpuInfo(d: { gpu?: string | null; soc?: string | null }): GpuInfo {
  const own = (d.gpu ?? '').trim();
  const gpu = own || gpuOfSoc(d.soc);
  const { family, driver } = gpu ? gpuFamily(gpu) : { family: '', driver: '' };
  return { gpu, gpu_source: own ? 'device' : gpu ? 'chip' : '', gpu_family: family, gpu_driver: driver };
}

/** Does a device's GPU match a query: the exact GPU, its family, or words in either ("adreno 6", "valhall", "mali-g57")? */
export function gpuMatches(info: GpuInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || !info.gpu) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  if (norm(info.gpu).startsWith(norm(q)) || norm(info.gpu_family) === norm(q)) return true;
  // "Adreno 619" also matches family-only queries like "adreno 6xx".
  return norm(info.gpu_family).includes(norm(q)) || norm(info.gpu).includes(norm(q));
}
