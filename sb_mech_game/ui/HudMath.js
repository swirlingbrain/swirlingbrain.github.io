// Pure math helpers for the HUD. No DOM, no THREE.js — everything here is a
// plain function of plain data so it can be unit tested directly (see
// tests/hud-math.test.js). ui/Hud.js is responsible for taking these results
// and pushing them into actual DOM/canvas elements.

/**
 * Projects otherMech's world position into a radar-space pixel offset relative
 * to selfMech, rotated into selfMech's body-heading frame (legYaw) so "ahead"
 * always renders toward the top of the radar regardless of which way the mech
 * is currently facing.
 *
 * Deliberately uses legYaw (body/leg heading) rather than legYaw+torsoYaw: the
 * radar is a body-relative minimap that should stay stable while the player
 * freely swings their torso/reticle around, matching how MechState's own
 * integrateMovement() treats legYaw as the mech's true heading.
 *
 * @param {{position:{x:number,z:number}, legYaw:number}} selfMech
 * @param {{position:{x:number,z:number}}} otherMech
 * @param {number} radarRangeUnits world-space radius the radar covers
 * @param {number} radarPixelRadius pixel radius of the radar's drawable area
 * @returns {{x:number, y:number}|null} pixel offset from radar center
 *   (x: right+, y: down+, matching CSS/canvas screen space), or null if
 *   otherMech is beyond radarRangeUnits.
 */
export function worldToRadarPosition(selfMech, otherMech, radarRangeUnits, radarPixelRadius) {
  const dx = otherMech.position.x - selfMech.position.x;
  const dz = otherMech.position.z - selfMech.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance > radarRangeUnits) return null;
  if (distance === 0) return { x: 0, y: 0 };

  const yaw = selfMech.legYaw;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  // Same forward-vector convention as MechState.integrateMovement, which uses
  // forward = (-sin(yaw), -cos(yaw)) in (x,z). "right" is forward rotated so
  // the two are orthonormal: right = (cos(yaw), -sin(yaw)).
  const localRight = dx * cos - dz * sin;
  const localForward = -dx * sin - dz * cos;

  const scale = radarPixelRadius / radarRangeUnits;
  return {
    x: localRight * scale,
    y: -localForward * scale, // ahead (positive localForward) => negative y => screen "up"
  };
}

/**
 * Categorizes a [0,1] fraction into the HUD's shared semantic color language.
 * Callers compute the fraction relative to whatever "danger ceiling" applies
 * to their own stat (e.g. heat/HEAT_SHUTDOWN_THRESHOLD, or 1 - armorFraction)
 * so this function never needs to know about any specific stat's absolute
 * scale.
 *
 * @param {number} heatFraction value in [0,1]; <0.6 good, <0.9 warn, else critical
 * @returns {'good'|'warn'|'critical'}
 */
export function heatToColor(heatFraction) {
  if (heatFraction < 0.6) return 'good';
  if (heatFraction < 0.9) return 'warn';
  return 'critical';
}

/** Euclidean distance between two {x,y,z}-shaped points (y optional/defaults to 0). */
export function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = (a.y || 0) - (b.y || 0);
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Nearest alive mech on a different team from selfMech, or null if none exist.
 * Used as the HUD's fallback "nearest target" readout when no explicit lock
 * (mech.currentTargetId, set by AI/Integration) is available.
 */
export function findNearestEnemy(selfMech, mechs) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const other of mechs) {
    if (other === selfMech) continue;
    if (other.team === selfMech.team) continue;
    if (!other.alive) continue;
    const d = distanceBetween(selfMech.position, other.position);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = other;
    }
  }
  return nearest;
}

/**
 * Overall health fraction across every location (armor + structure combined,
 * against their combined max), for the HUD's target health-bar readout. This
 * intentionally differs from an armor-only fraction: a location can be at 0
 * armor and still have structure left, and should read as more than 0 health.
 */
export function computeHealthFraction(mech) {
  let current = 0;
  let max = 0;
  for (const key of Object.keys(mech.locations)) {
    const loc = mech.locations[key];
    current += loc.armor + loc.structure;
    max += loc.maxArmor + loc.maxStructure;
  }
  if (max === 0) return 0;
  return current / max;
}
