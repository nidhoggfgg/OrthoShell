# Test Image Set

This directory contains procedural test images for the voxel generator.

Recommended first pass:

- Use the default filter settings for `01` through `04`
- Use the default filter settings for `05`, then compare with looser RGB thresholds if you want to stress-test background cleanup
- Start with `resolution = 150`, `shell thickness = 2`, `internal culling = on`

Files:

- `01_capsule_front.png` / `01_capsule_side.png`: simple baseline shape for checking the end-to-end flow
- `02_ring_front.png` / `02_ring_side.png`: hollow shape for validating hole preservation and shell stripping
- `03_handle_front.png` / `03_handle_side.png`: asymmetric shape for checking width/depth recovery
- `04_leaf_antialias_front.png` / `04_leaf_antialias_side.png`: soft-edged transparent PNGs for testing anti-aliased boundaries
- `05_dirty_bg_front.png` / `05_dirty_bg_side.png`: noisy light background with shadow for testing RGB filtering on non-transparent inputs
