// Pure combat math shared between the player's own hit-test (main.js) and
// AI targeting/movement (ai/Behavior.js) -- previously each defined its own
// copy of the same angle math, and hit-location weighting lived trapped
// inside main.js where it couldn't be unit-tested at all. Zero 'three'/DOM
// dependency, consistent with the rest of this codebase's pure-math modules
// (world/TerrainConstants.js, ui/HudMath.js).

/**
 * Angle (in the same convention as mech.legYaw/torsoYaw) that points from
 * `fromPos` to `toPos`, matching mech/MechState.js's integrateMovement,
 * where a mech facing angle theta moves along (-sin(theta), -cos(theta)).
 */
export function angleBetween(fromPos, toPos) {
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  return Math.atan2(-dx, -dz);
}

/** Wraps any angle into (-PI, PI], the range every facing/turn calculation in this codebase assumes. */
export function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Weighted hit-location table approximating real mech combat's center-mass
// bias (no real raycasting against body geometry in this pass).
export const HIT_LOCATION_TABLE = [
  ['ct', 0.28], ['lt', 0.14], ['rt', 0.14], ['la', 0.11], ['ra', 0.11],
  ['ll', 0.10], ['rl', 0.10], ['head', 0.02],
];

/** Rolls a weighted-random location key from HIT_LOCATION_TABLE. Falls back to 'ct' if the weights don't sum to exactly 1 due to floating point. */
export function pickHitLocation() {
  let r = Math.random();
  for (const [key, weight] of HIT_LOCATION_TABLE) {
    if (r < weight) return key;
    r -= weight;
  }
  return 'ct';
}
