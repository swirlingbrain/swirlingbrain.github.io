// Pure terrain data/math -- deliberately has ZERO dependency on 'three' (or
// any DOM/rendering API), so it can be imported by non-rendering code (e.g.
// ai/Behavior.js's cover-seeking, or the test harness) without dragging in
// THREE.js. world/Terrain.js imports from here for its rendering-side needs
// and re-exports what it needs for backward compatibility; anything that
// only needs the pure data/math should import directly from this file
// instead, the way ai/Behavior.js does for COVER_OBSTACLES.

// Playable/walkable map area is capped to TERRAIN_SIZE x TERRAIN_SIZE units
// (see render/SceneSetup.js implementation notes for why: this lets the sun's
// shadow-camera frustum be sized once, statically, to cover the whole map).
export const TERRAIN_SIZE = 200;
export const HEIGHT_SCALE = 8;
const NOISE_FREQUENCY = 0.045;

// Approximate bounding circles around the rock cluster and ruined structure,
// sized to cover their actual generated extent (see Terrain.js's
// buildRockCluster/buildRuinedStructure). Used by Integration for
// mech-vs-terrain-prop collision (a cheap circle check rather than full mesh
// collision, since a mech's plan-view footprint is roughly circular) and by
// AI as cover-seeking destinations when retreating.
export const COVER_OBSTACLES = [
  { x: 45, z: -35, radius: 14 },
  { x: -50, z: 40, radius: 13 },
];

// --- Deterministic value-noise height field (no external noise library
// needed, no CDN dependency beyond three itself for the mesh-building side) ---

function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, z, octaves = 4) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += smoothNoise(x * frequency, z * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / maxAmplitude;
}

/** Rolling-hills height at a given world x/z, in the same units as scene geometry. */
export function getTerrainHeight(x, z) {
  return fbm(x * NOISE_FREQUENCY, z * NOISE_FREQUENCY) * HEIGHT_SCALE;
}

// Exported for Terrain.js's mesh-building code, which needs the same noise
// function for rock/rubble placement jitter.
export { smoothNoise };
