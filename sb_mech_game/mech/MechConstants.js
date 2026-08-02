export const TORSO_TWIST_LIMIT = Math.PI / 3;
export const LEG_TURN_RATE = 1.6;
export const MAX_FORWARD_SPEED = 12;
export const MAX_REVERSE_SPEED = 5;
export const THROTTLE_ACCEL = 8;
export const PITCH_LIMIT = Math.PI / 3;
export const LOOK_YAW_SENSITIVITY = 0.0025;
export const LOOK_PITCH_SENSITIVITY = 0.0025;
export const HEAT_MAX = 100;
export const HEAT_DECAY_RATE = 6;
export const HEAT_SHUTDOWN_THRESHOLD = 90;
export const HEAT_SHUTDOWN_RECOVERY = 40;

export const DEFAULT_LOCATION_ARMOR = {
  head: 18, ct: 40, lt: 28, rt: 28, la: 20, ra: 20, ll: 24, rl: 24,
};

export const DEFAULT_LOCATION_STRUCTURE = {
  head: 9, ct: 20, lt: 14, rt: 14, la: 10, ra: 10, ll: 12, rl: 12,
};

// medium MUST stay {1, 1, 1}: every two-argument createMech(id, team) call
// implicitly becomes medium, and Phase 0's baseline tests assert exact
// values against that call. Changing medium's multipliers away from 1.0
// silently breaks those tests (this happened once already).
export const CHASSIS_DEFS = {
  light: { speedMultiplier: 1.4, armorMultiplier: 0.7, torsoTwistLimitMultiplier: 1.2 },
  medium: { speedMultiplier: 1.0, armorMultiplier: 1.0, torsoTwistLimitMultiplier: 1.0 },
  heavy: { speedMultiplier: 0.75, armorMultiplier: 1.35, torsoTwistLimitMultiplier: 0.85 },
  assault: { speedMultiplier: 0.55, armorMultiplier: 1.8, torsoTwistLimitMultiplier: 0.7 },
};
export const DEFAULT_CHASSIS_TYPE = 'medium';
