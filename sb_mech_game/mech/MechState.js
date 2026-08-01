import {
  DEFAULT_LOCATION_ARMOR, DEFAULT_LOCATION_STRUCTURE,
  MAX_FORWARD_SPEED, MAX_REVERSE_SPEED, THROTTLE_ACCEL, LEG_TURN_RATE,
  TORSO_TWIST_LIMIT, PITCH_LIMIT, HEAT_MAX, HEAT_DECAY_RATE,
} from './MechConstants.js';

export function createMech(id, team) {
  const locations = {};
  for (const key of Object.keys(DEFAULT_LOCATION_ARMOR)) {
    locations[key] = {
      armor: DEFAULT_LOCATION_ARMOR[key],
      maxArmor: DEFAULT_LOCATION_ARMOR[key],
      structure: DEFAULT_LOCATION_STRUCTURE[key],
      maxStructure: DEFAULT_LOCATION_STRUCTURE[key],
      destroyed: false,
    };
  }

  return {
    id,
    team,
    position: { x: 0, y: 0, z: 0 },
    legYaw: 0,
    torsoYaw: 0,
    pitch: 0,
    throttleInput: 0,
    speed: 0,
    heat: 0,
    alive: true,
    legsDisabled: false,
    locations,
  };
}

export function applyThrottleInput(mech, throttleInput, dt) {
  mech.throttleInput = throttleInput;
  if (mech.legsDisabled) {
    mech.speed = 0;
    return;
  }
  const targetSpeed = throttleInput >= 0
    ? throttleInput * MAX_FORWARD_SPEED
    : throttleInput * MAX_REVERSE_SPEED;
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
  const next = mech.torsoYaw + deltaYaw;
  if (next > TORSO_TWIST_LIMIT) {
    mech.legYaw += next - TORSO_TWIST_LIMIT;
    mech.torsoYaw = TORSO_TWIST_LIMIT;
  } else if (next < -TORSO_TWIST_LIMIT) {
    mech.legYaw += next + TORSO_TWIST_LIMIT;
    mech.torsoYaw = -TORSO_TWIST_LIMIT;
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
