import { HEAT_SHUTDOWN_THRESHOLD } from '../mech/MechConstants.js';
import { SENSOR_RANGE, RETREAT_ARMOR_FRACTION, RETREAT_HEAT_FRACTION } from './AiConstants.js';
import { COVER_OBSTACLES, isLineOfSightBlocked } from '../world/TerrainConstants.js';

function distanceBetween(a, b) {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// obstacles defaults to the real map's COVER_OBSTACLES but is overridable so
// tests can check blocking behavior with synthetic obstacles instead of
// depending on real map coordinates. Previously this was a pure distance +
// team + alive check with no raycasting/occlusion at all -- real playtesting
// asked for cover that actually stops shots, not just movement, so an enemy
// behind a rock/ruin is now excluded even if it's within sensor range.
export function findVisibleEnemies(mech, allMechs, obstacles = COVER_OBSTACLES) {
  return allMechs.filter((other) => (
    other.id !== mech.id
    && other.team !== mech.team
    && other.alive
    && distanceBetween(mech, other) <= SENSOR_RANGE
    && !isLineOfSightBlocked(mech.position, other.position, obstacles)
  ));
}

export function computeAverageArmorFraction(mech) {
  const keys = Object.keys(mech.locations);
  let armorSum = 0;
  let maxArmorSum = 0;
  for (const key of keys) {
    armorSum += mech.locations[key].armor;
    maxArmorSum += mech.locations[key].maxArmor;
  }
  if (maxArmorSum === 0) return 0;
  return armorSum / maxArmorSum;
}

export function shouldRetreat(mech) {
  return computeAverageArmorFraction(mech) < RETREAT_ARMOR_FRACTION
    || mech.heat > HEAT_SHUTDOWN_THRESHOLD * RETREAT_HEAT_FRACTION;
}

export function selectFocusTarget(mech, allMechs) {
  const visibleEnemies = findVisibleEnemies(mech, allMechs);
  if (visibleEnemies.length === 0) return null;

  const teammates = allMechs.filter((other) => (
    other.id !== mech.id && other.team === mech.team && other.alive
  ));

  const targetVotes = new Map();
  for (const teammate of teammates) {
    if (teammate.currentTargetId) {
      targetVotes.set(
        teammate.currentTargetId,
        (targetVotes.get(teammate.currentTargetId) || 0) + 1,
      );
    }
  }

  let best = null;
  let bestVotes = -1;
  let bestArmorFraction = Infinity;
  let bestDistance = Infinity;

  for (const enemy of visibleEnemies) {
    const votes = targetVotes.get(enemy.id) || 0;
    const armorFraction = computeAverageArmorFraction(enemy);
    const dist = distanceBetween(mech, enemy);

    const better = (
      votes > bestVotes
      || (votes === bestVotes && armorFraction < bestArmorFraction)
      || (votes === bestVotes && armorFraction === bestArmorFraction && dist < bestDistance)
    );

    if (better) {
      best = enemy;
      bestVotes = votes;
      bestArmorFraction = armorFraction;
      bestDistance = dist;
    }
  }

  return best;
}
