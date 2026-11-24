-- 0017: a device's GPU. Additive only, D1-safe.
--
-- devices.gpu  the GPU when a maintainer or an admin names it, e.g.
--              "Adreno 619". Empty means: take it from the chip
--              (src/lib/gpu.ts SOC_GPU). The API always answers gpu,
--              gpu_source (device | chip), gpu_family (e.g. "Adreno 6xx",
--              "Mali Valhall (JM)") and gpu_driver (the open driver that is
--              the hardware reference), and filters with ?gpu=.

ALTER TABLE devices ADD COLUMN gpu TEXT NOT NULL DEFAULT '';
