-- 0013: GPU acceleration split by API. Additive only, D1-safe.
--
-- areas 'metal'  Metal acceleration: Metal apps and the UI render on the GPU
--                (a native Metal driver, or Metal translated to Vulkan or GL,
--                e.g. metal2vulkan on Mesa's Turnip).
-- areas 'gles'   OpenGL ES acceleration: OpenGL ES renders on the GPU (Mesa's
--                freedreno, Turnip or Panfrost, or the vendor driver).
-- 'gpu' (GPU compositing) stays: the system interface is composited on the GPU.

INSERT OR IGNORE INTO areas (slug, name, notes, scope)
VALUES ('metal', 'Metal acceleration', 'Metal apps and the UI render on the GPU (native driver, or Metal translated to Vulkan / GL)', 'all');

INSERT OR IGNORE INTO areas (slug, name, notes, scope)
VALUES ('gles', 'OpenGL ES acceleration', 'OpenGL ES renders on the GPU (Mesa freedreno / Turnip / Panfrost, or the vendor driver)', 'all');
