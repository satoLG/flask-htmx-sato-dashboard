# Sato

- `sato-source.glb`: original supplied by the repository owner (Tripo exporter),
  607,592 bytes, 48 skinned meshes, one shared 41-bone skeleton, embedded textures.
  Its only animation is `NlaTrack`, 12.291667 seconds: breathing/weight-shift idle.
- `sato.glb`: generated runtime asset. Geometry, materials, textures, weights and
  the original idle keyframes are preserved. `NlaTrack` is named `Idle`, and
  `Walk` adds a periodic 0.88-second in-place gait with opposite arm swing,
  two-bone leg IK, planted support feet and a lifted swing foot.

Regenerate with `npm ci && npm run build:sato`. The generator takes an optional
path to a different copy of the original GLB. Do not feed the generated GLB back
into the generator. Source and generated files are committed; Node is not needed
in production. This file documents provenance, not a separate asset license.

The scene normalizes the character to 2.45 units before its existing 1.12 scene
scale. Positive Z is forward. Navigation moves the root; the walk never adds
root displacement. Cadence follows actual collision-resolved speed and the
0.76 model-unit distance per cycle. Weighted idle/walk blending retains both
phases on interruptions, taking approximately 0.3 seconds to settle. Pausing
animations/reduced motion settles to the first idle pose.

The GLTFLoader bundle shares the existing local Three.js 0.180.0 module and its
MIT license in `static/vendor/THREE-LICENSE.txt`; rebuild both via
`npm run build:three`. No CDN or runtime model service is used.

Checks: `npm run test:avatar`, `npm run test:navigation`, and
`npx playwright test tests/browser/avatar.spec.cjs tests/browser/lab.spec.cjs`.
