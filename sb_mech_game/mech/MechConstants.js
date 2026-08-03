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

// Doubled from the original Phase 1 values after real playtesting kept
// reporting "dies too easily" even with cover added. A worst-case
// simulation (all 4 enemies converging fire on one target with perfect
// aim/no misses) showed the original armor pool died in ~1.5s median --
// not enough time for a human to notice and react, let alone retreat.
// Doubling brought that same worst case to ~2.3s median (3.8s max) and a
// realistic single-enemy duel to ~7.4s median, without needing a 3x+ bump
// that would make ordinary 1-on-1 fights drag.
export const DEFAULT_LOCATION_ARMOR = {
  head: 36, ct: 80, lt: 56, rt: 56, la: 40, ra: 40, ll: 48, rl: 48,
};

export const DEFAULT_LOCATION_STRUCTURE = {
  head: 18, ct: 40, lt: 28, rt: 28, la: 20, ra: 20, ll: 24, rl: 24,
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
