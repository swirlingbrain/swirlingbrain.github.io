import { shouldRetreat, selectFocusTarget } from './Targeting.js';
import {
  ENGAGEMENT_RANGE, AI_FIRE_CONE_RADIANS, AI_FLANK_ANGLE_RADIANS,
  AI_IDLE_THROTTLE, AI_RETREAT_ARRIVAL_DISTANCE, AI_LOOK_TURN_RATE,
} from './AiConstants.js';
import { COVER_OBSTACLES } from '../world/TerrainConstants.js';

function distanceBetween(a, b) {
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// Angle (in the same convention as mech.legYaw/torsoYaw) that points from
// `from` to `to`, matching mech/MechState.js's integrateMovement, where a
// mech facing angle theta moves along (-sin(theta), -cos(theta)).
function angleTo(from, to) {
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  return Math.atan2(-dx, -dz);
}

function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function facingAngle(mech) {
  return mech.legYaw + mech.torsoYaw;
}

// Turn-toward-angle helper capped at AI_LOOK_TURN_RATE radians/sec, so it
// closes the gap without overshoot and stays framerate-independent (applyLookYaw
// applies this delta directly with no dt scaling of its own -- see AiConstants.js).
function lookYawDeltaToward(mech, targetAngle, dt) {
  const diff = normalizeAngle(targetAngle - facingAngle(mech));
  const maxStep = AI_LOOK_TURN_RATE * dt;
  if (Math.abs(diff) <= maxStep) return diff;
  return Math.sign(diff) * maxStep;
}

// Deterministic per-mech flank offset (derived from mech.id) so allies
// approaching the same target naturally fan out to either side instead of
// clumping into a single-file beeline.
function flankOffsetForMech(mech) {
  const idStr = String(mech.id);
  let hash = 0;
  for (let i = 0; i < idStr.length; i += 1) {
    hash = (hash * 31 + idStr.charCodeAt(i)) | 0;
  }
  const sign = (Math.abs(hash) % 2 === 0) ? 1 : -1;
  return sign * AI_FLANK_ANGLE_RADIANS;
}

function nearestAliveTeammate(mech, allMechs) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const other of allMechs) {
    if (other.id === mech.id || other.team !== mech.team || !other.alive) continue;
    const dist = distanceBetween(mech, other);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }
  return { teammate: nearest, distance: nearestDist };
}

// Nearest terrain cover point (rock cluster / ruined structure), wrapped in a
// mech-shaped {position} object so it can be passed anywhere a real mech is
// expected (angleTo only ever reads .position.x/z).
function nearestCoverPoint(mech) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const obstacle of COVER_OBSTACLES) {
    const dx = obstacle.x - mech.position.x;
    const dz = obstacle.z - mech.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { position: { x: obstacle.x, z: obstacle.z } };
    }
  }
  return { coverPoint: nearest, distance: nearestDist };
}

// Returns { throttleInput, legTurnInput, lookYawDelta, lookPitchDelta, wantsToFire, targetId }.
// Note: targetId is NOT part of the plan's headline interface-contract snippet -- it's an
// intentional extension per the selectFocusTarget spec (see the Phase 1 plan's Task Group B
// section). Integration MUST assign mech.currentTargetId = result.targetId after every call,
// or selectFocusTarget's cross-teammate focus-fire convergence silently never engages (no test
// will catch this since it's a downstream wiring requirement, not a bug in this function).
export function decideAction(mech, world, dt) {
  const allMechs = world.mechs;

  if (shouldRetreat(mech)) {
    // Flee toward whichever is closer: a living teammate, or terrain cover
    // (the rock cluster / ruined structure) -- genuine cover-seeking rather
    // than always regrouping on a teammate regardless of nearby terrain.
    const { teammate, distance: teammateDistance } = nearestAliveTeammate(mech, allMechs);
    const { coverPoint, distance: coverDistance } = nearestCoverPoint(mech);

    let fleeTarget = null;
    let fleeDistance = Infinity;
    if (teammate && teammateDistance < fleeDistance) {
      fleeTarget = teammate;
      fleeDistance = teammateDistance;
    }
    if (coverPoint && coverDistance < fleeDistance) {
      fleeTarget = coverPoint;
      fleeDistance = coverDistance;
    }

    if (fleeTarget && fleeDistance > AI_RETREAT_ARRIVAL_DISTANCE) {
      const targetAngle = angleTo(mech, fleeTarget);
      const lookYawDelta = lookYawDeltaToward(mech, targetAngle, dt);
      const moveAngleDiff = normalizeAngle(targetAngle - mech.legYaw);
      return {
        throttleInput: 1,
        legTurnInput: Math.max(-1, Math.min(1, moveAngleDiff * 0.6)),
        lookYawDelta,
        lookPitchDelta: 0,
        wantsToFire: false,
        targetId: null,
      };
    }

    // No living teammate to fall back to (or already reached them) -- hold
    // position rather than freeze into a genuinely no-op action; still
    // correctly refuses to push toward danger while critically damaged/hot.
    return {
      throttleInput: 0,
      legTurnInput: 0,
      lookYawDelta: 0,
      lookPitchDelta: 0,
      wantsToFire: false,
      targetId: null,
    };
  }

  const target = selectFocusTarget(mech, allMechs);

  if (!target) {
    // Idle/patrol: slow forward creep, never a hard freeze.
    return {
      throttleInput: AI_IDLE_THROTTLE,
      legTurnInput: 0,
      lookYawDelta: 0,
      lookPitchDelta: 0,
      wantsToFire: false,
      targetId: null,
    };
  }

  const rawAngleToTarget = angleTo(mech, target);
  const flankedAngle = normalizeAngle(rawAngleToTarget + flankOffsetForMech(mech));
  const facingDiffToTarget = Math.abs(normalizeAngle(rawAngleToTarget - facingAngle(mech)));
  const distanceToTarget = distanceBetween(mech, target);

  const lookYawDelta = lookYawDeltaToward(mech, rawAngleToTarget, dt);

  // Steer legs toward the flanked approach vector (not a beeline to the
  // target) so allies spread out around it rather than stacking single-file.
  const moveAngleDiff = normalizeAngle(flankedAngle - mech.legYaw);
  const legTurnInput = Math.max(-1, Math.min(1, moveAngleDiff * 0.5));

  const wantsToFire = facingDiffToTarget <= AI_FIRE_CONE_RADIANS
    && distanceToTarget <= ENGAGEMENT_RANGE;

  // Close distance while outside engagement range; ease off once comfortably
  // inside it so the mech doesn't run past/through its target.
  const throttleInput = distanceToTarget > ENGAGEMENT_RANGE * 0.5 ? 1 : 0.3;

  return {
    throttleInput,
    legTurnInput,
    lookYawDelta,
    lookPitchDelta: 0,
    wantsToFire,
    targetId: target.id,
  };
}
