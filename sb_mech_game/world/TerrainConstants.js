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

// Approximate bounding circles around each cover cluster, sized to cover its
// actual generated extent (see Terrain.js's buildRockCluster/
// buildRuinedStructure). Used by Integration for mech-vs-terrain-prop
// collision (a cheap circle check rather than full mesh collision, since a
// mech's plan-view footprint is roughly circular), by AI as cover-seeking
// destinations when retreating, and by isLineOfSightBlocked below to block
// weapon targeting -- real user playtesting found the original 2 obstacles
// sat off in the map's corners, away from the lane mechs actually fight
// along (spawns face each other across the x axis near z=0), so a typical
// match never encountered any cover at all. These 6 are spread across that
// central engagement band instead. `type` picks which mesh Terrain.js builds
// at that position ('rock' or 'ruin'); every obstacle is tall enough (see
// Terrain.js) to block line of sight regardless of type.
// Kept clear of the x=0 and z=0 axes by a comfortable margin beyond each
// radius -- several unit tests place a mech at the default (0,0,0) and an
// enemy directly along one axis (e.g. z=-50 with x=0) to test facing/cone
// logic; an obstacle straddling that exact line would silently fail those
// tests by blocking line of sight the test never intended to exercise.
export const COVER_OBSTACLES = [
  { x: 45, z: -35, radius: 14, type: 'rock' },
  { x: -50, z: 40, radius: 13, type: 'ruin' },
  { x: 20, z: 18, radius: 11, type: 'rock' },
  { x: -25, z: -20, radius: 12, type: 'ruin' },
  { x: 8, z: 32, radius: 10, type: 'ruin' },
  { x: -18, z: -30, radius: 11, type: 'rock' },
  // Added on request for more rock outcroppings specifically -- these fill
  // quadrants the original 6 left sparse (far positive-x/positive-z, and
  // further out toward the map edges), still clear of the x=0/z=0 axes.
  { x: 55, z: 30, radius: 12, type: 'rock' },
  { x: 28, z: -62, radius: 11, type: 'rock' },
  { x: -48, z: -55, radius: 12, type: 'rock' },
  { x: 65, z: -18, radius: 9, type: 'rock' },
];

// Treats each obstacle as a full-height vertical cylinder (a reasonable
// simplification: every cover mesh Terrain.js builds is already taller than
// a mech's weapon-mounting height) and does a 2D segment-vs-circle
// intersection test in the x/z plane, ignoring y entirely. Shared by AI
// targeting and the player's own hit-test so both respect the same cover.
function distancePointToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const abLengthSquared = abx * abx + abz * abz;
  let t = abLengthSquared > 0 ? ((px - ax) * abx + (pz - az) * abz) / abLengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + abx * t;
  const closestZ = az + abz * t;
  const dx = px - closestX;
  const dz = pz - closestZ;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isLineOfSightBlocked(fromPos, toPos, obstacles = COVER_OBSTACLES) {
  for (const obstacle of obstacles) {
    const dist = distancePointToSegment(
      obstacle.x, obstacle.z, fromPos.x, fromPos.z, toPos.x, toPos.z,
    );
    if (dist < obstacle.radius) return true;
  }
  return false;
}

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
