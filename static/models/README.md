# Sato

- `sato-source.glb`: original supplied by the repository owner (Tripo exporter),
  607,592 bytes, 48 skinned meshes, one shared 41-bone skeleton, embedded textures.
  Its only animation is `NlaTrack`, 12.291667 seconds: breathing/weight-shift idle.
- `sato.glb`: repaired runtime asset. Near-coincident surface vertices share
  positions and weights, closing animated seams. Added knee support rings let
  the trousers bend at the knee; lower soles and the head have rigid weights.
  Textures and the original source file are preserved.
  The body and limb bind pose mirror the anatomical right side onto the left;
  inverse bind matrices are rebuilt to match. Feet face forward with a natural
  gap, and the ankles sit beneath the hips instead of behind them.
- `Idle` (4.8 s): authored breathing with stationary root/hip XZ and anchored feet.
- `Walk` (0.92 s): two-bone knee IK, bind-space sole orientation, distributed
  pelvis/spine movement and opposite arm swing. Shorter steps, slightly higher
  swing clearance and less hip drop reduce the crouch.
- `Blink` (4.6 s): independent, brief pupil/highlight closure behind the glasses.
  The neck faces forward with a slight upward angle.
  Eye details sit against the face; the front of the glasses is moved closer
  while their ear attachments stay in place.

Regenerate with `npm ci && npm run build:sato`. The generator takes an optional
path to a different copy of the original GLB. Do not feed the generated GLB back
into the generator. Source and generated files are committed; Node is not needed
in production. This file documents provenance, not a separate asset license.

The scene normalizes the character to 2.45 units before its existing 1.12 scene
scale. Positive Z is forward. Navigation moves the root; the walk never adds
root displacement. Cadence follows actual collision-resolved speed and the
0.56 model-unit distance per cycle. Weighted idle/walk blending retains both
phases on interruptions, taking approximately 0.3 seconds to settle. Pausing
animations/reduced motion settles to the first idle pose.

The GLTFLoader bundle shares the existing local Three.js 0.180.0 module and its
MIT license in `static/vendor/THREE-LICENSE.txt`; rebuild both via
`npm run build:three`. No CDN or runtime model service is used.

Checks: `npm run test:avatar`, `npm run test:navigation`, and
`npx playwright test tests/browser/avatar.spec.cjs tests/browser/lab.spec.cjs`.

The lab recalculates its real shadow maps on every rendered frame (30 fps scene cap).
