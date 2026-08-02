export const SENSOR_RANGE = 400;
export const RETREAT_ARMOR_FRACTION = 0.25; // retreat when average remaining armor fraction drops below this
export const RETREAT_HEAT_FRACTION = 0.8; // retreat when heat exceeds this fraction of HEAT_SHUTDOWN_THRESHOLD
// AI tries to close to within this range before committing to fire. Deliberately
// kept well SHORTER than the ~170-unit spawn separation (see main.js's
// SPAWN_RADIUS) so there's a genuine approach phase before anyone can shoot --
// this was originally 250 (bigger than the old ~120-unit spawn gap, so combat
// started on tick one with zero reaction time) then 130 (closing the ~40-unit
// gap only bought about 2.4 real-time seconds before the player took damage,
// and ~5s before dying with no player input at all -- still confirmed too
// punishing by real user playtesting). 90 requires closing roughly 80 units,
// pushing first contact out further and giving a real player meaningfully
// more time to get oriented, aim, and react before anyone can fire.
export const ENGAGEMENT_RANGE = 90;

// The following are AI-internal tuning constants, not part of the plan's
// prescribed list above, used only by ai/Behavior.js for steering/facing.
// Kept here (rather than inline magic numbers) so they're easy to retune.
export const AI_FIRE_CONE_RADIANS = Math.PI / 9; // +/-20 degrees
export const AI_FLANK_ANGLE_RADIANS = Math.PI / 6; // 30 degree flank offset from a beeline approach
export const AI_IDLE_THROTTLE = 0.2; // slow patrol speed when no target is visible
export const AI_RETREAT_ARRIVAL_DISTANCE = 15; // stop closing once this close to the teammate being retreated toward
// applyLookYaw adds lookYawDelta directly with no internal dt scaling (unlike
// applyLegTurnInput, which is scaled by dt downstream) -- main.js gets away
// with that for the player because raw mouse deltas are inherently per-event,
// not a continuous rate. The AI has no such per-frame device input; it picks
// a target angle fresh from world state each tick, so its turn must be
// explicitly scaled by dt here to stay framerate-independent.
export const AI_LOOK_TURN_RATE = 1.5; // radians/sec max torso+leg turn-toward-target rate
