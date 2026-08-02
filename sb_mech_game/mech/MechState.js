import {
  DEFAULT_LOCATION_ARMOR, DEFAULT_LOCATION_STRUCTURE,
  MAX_FORWARD_SPEED, MAX_REVERSE_SPEED, THROTTLE_ACCEL, LEG_TURN_RATE,
  TORSO_TWIST_LIMIT, PITCH_LIMIT, HEAT_MAX, HEAT_DECAY_RATE,
  HEAT_SHUTDOWN_THRESHOLD, HEAT_SHUTDOWN_RECOVERY,
  CHASSIS_DEFS, DEFAULT_CHASSIS_TYPE,
} from './MechConstants.js';

export function createMech(id, team, chassisType = DEFAULT_CHASSIS_TYPE) {
  const resolvedChassisType = CHASSIS_DEFS[chassisType] ? chassisType : DEFAULT_CHASSIS_TYPE;
  const { armorMultiplier } = CHASSIS_DEFS[resolvedChassisType];
  const locations = {};
  for (const key of Object.keys(DEFAULT_LOCATION_ARMOR)) {
    const scaledArmor = Math.round(DEFAULT_LOCATION_ARMOR[key] * armorMultiplier);
    locations[key] = {
      armor: scaledArmor,
      maxArmor: scaledArmor,
      structure: DEFAULT_LOCATION_STRUCTURE[key],
      maxStructure: DEFAULT_LOCATION_STRUCTURE[key],
      destroyed: false,
    };
  }

  return {
    id,
    team,
    chassisType: resolvedChassisType,
    position: { x: 0, y: 0, z: 0 },
    legYaw: 0,
    torsoYaw: 0,
    pitch: 0,
    throttleInput: 0,
    speed: 0,
    heat: 0,
    alive: true,
    legsDisabled: false,
    shutdown: false,
    locations,
  };
}

export function updateHeatShutdown(mech) {
  if (!mech.shutdown && mech.heat >= HEAT_SHUTDOWN_THRESHOLD) {
    mech.shutdown = true;
  } else if (mech.shutdown && mech.heat <= HEAT_SHUTDOWN_RECOVERY) {
    mech.shutdown = false;
  }
}

export function applyThrottleInput(mech, throttleInput, dt) {
  mech.throttleInput = throttleInput;
  if (mech.legsDisabled || mech.shutdown) {
    mech.speed = 0;
    return;
  }
  const { speedMultiplier } = CHASSIS_DEFS[mech.chassisType] || CHASSIS_DEFS[DEFAULT_CHASSIS_TYPE];
  const targetSpeed = throttleInput >= 0
    ? throttleInput * MAX_FORWARD_SPEED * speedMultiplier
    : throttleInput * MAX_REVERSE_SPEED * speedMultiplier;
  const maxDelta = THROTTLE_ACCEL * dt;
  const delta = targetSpeed - mech.speed;
  mech.speed += Math.abs(delta) <= maxDelta ? delta : Math.sign(delta) * maxDelta;
}

export function applyLegTurnInput(mech, legTurnInput, dt) {
  mech.legYaw += legTurnInput * LEG_TURN_RATE * dt;
}

export function integrateMovement(mech, dt) {
  mech.position.x += -Math.sin(mech.legYaw) * mech.speed * dt;
  mech.position.z += -Math.cos(mech.legYaw) * mech.speed * dt;
}

export function applyLookYaw(mech, deltaYaw) {
  const { torsoTwistLimitMultiplier } = CHASSIS_DEFS[mech.chassisType] || CHASSIS_DEFS[DEFAULT_CHASSIS_TYPE];
  const limit = TORSO_TWIST_LIMIT * torsoTwistLimitMultiplier;
  const next = mech.torsoYaw + deltaYaw;
  if (next > limit) {
    mech.legYaw += next - limit;
    mech.torsoYaw = limit;
  } else if (next < -limit) {
    mech.legYaw += next + limit;
    mech.torsoYaw = -limit;
  } else {
    mech.torsoYaw = next;
  }
}

export function applyLookPitch(mech, deltaPitch) {
  mech.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, mech.pitch + deltaPitch));
}

export function addHeat(mech, amount) {
  mech.heat = Math.min(HEAT_MAX, mech.heat + amount);
}

export function decayHeat(mech, dt) {
  mech.heat = Math.max(0, mech.heat - HEAT_DECAY_RATE * dt);
}

export function applyDamage(mech, locationKey, amount) {
  const loc = mech.locations[locationKey];
  if (!loc || loc.destroyed) return;

  if (loc.armor > 0) {
    const overflow = amount - loc.armor;
    loc.armor = Math.max(0, loc.armor - amount);
    if (overflow > 0) {
      applyStructureDamage(mech, locationKey, overflow);
    }
  } else {
    applyStructureDamage(mech, locationKey, amount);
  }
}

function applyStructureDamage(mech, locationKey, amount) {
  const loc = mech.locations[locationKey];
  loc.structure = Math.max(0, loc.structure - amount);
  if (loc.structure === 0) {
    loc.destroyed = true;
    if (locationKey === 'ct' || locationKey === 'head') {
      mech.alive = false;
    }
    if (locationKey === 'll' || locationKey === 'rl') {
      mech.legsDisabled = true;
      mech.speed = 0;
    }
  }
}
