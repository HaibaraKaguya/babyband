# 3D model assets

## Bundled now

### `vendor/three.min.js`

- three.js **r149** UMD build (MIT), vendored so H5/App-vue `renderjs` can load
  it with a normal `<script>` without adding a bundler dependency or relying on
  a CDN.
- Loaded by `src/components/HumanPose3D/HumanPose3D.vue` from
  `./static/models/vendor/three.min.js` (App) or
  `/static/models/vendor/three.min.js` (H5).
- License text: `vendor/THREE-LICENSE.txt`.

### `procedural/infant_rig_v1.json`

Documentation manifest for the **procedural** infant-like figure built at
runtime from three.js primitives in
`src/utils/pose3d/proceduralRig.js`. It is not a GLB/GLTF mesh and is not a
medical or anatomical model.

## Not bundled

No external infant scan/mesh has been downloaded, converted, or integrated.
Candidates evaluated:

- **Anny** (`naver/anny`, Apache-2.0, PyTorch): generates all-ages parametric
  bodies offline. It cannot run in a uni-app frontend, and no export pipeline
  was executed in this phase. A future asset phase could export a GLB offline
  and add a GLTF loader, but that is out of scope here.
- **MPFB2** (`makehumancommunity/mpfb2`, Blender add-on, license reported by
  GitHub as "Other"/NOASSERTION): not integrated because it requires Blender
  and its asset licensing would need a separate review.
- **minisheeep/threejs-miniprogram-template**: useful template reference but no
  license file and low activity; only read, no code copied.

See `docs/body3d/ASSET_PROVENANCE.md` for live stars/licenses at the time of
this phase.
