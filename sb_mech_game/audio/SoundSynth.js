// Pure sound-envelope logic — no AudioContext, no DOM, no side effects.
// Kept separate from AudioManager.js so it's unit-testable in the plain
// Node-less browser test harness (which has no real AudioContext).

const WEAPON_FIRE_ENVELOPES = {
  // Laser: sustained, higher-pitched tone.
  laser: {
    frequency: 1400,
    duration: 0.35,
    waveform: 'sine',
    attackSeconds: 0.02,
    decaySeconds: 0.2,
    amplitude: 0.6,
  },
  // Autocannon: short, sharp, low-frequency punch.
  autocannon: {
    frequency: 160,
    duration: 0.07,
    waveform: 'square',
    attackSeconds: 0.002,
    decaySeconds: 0.05,
    amplitude: 0.9,
  },
  // Missile: a lower, longer whoosh/launch envelope.
  missile: {
    frequency: 90,
    duration: 0.6,
    waveform: 'sawtooth',
    attackSeconds: 0.08,
    decaySeconds: 0.35,
    amplitude: 0.8,
  },
};

const DEFAULT_WEAPON_FIRE_TYPE = 'autocannon';

export function buildWeaponFireEnvelope(weaponType) {
  const envelope = WEAPON_FIRE_ENVELOPES[weaponType] || WEAPON_FIRE_ENVELOPES[DEFAULT_WEAPON_FIRE_TYPE];
  return { ...envelope };
}

// Impact envelope: scaled by damageAmount. Bigger hits are louder (higher
// amplitude), lower-pitched, and last slightly longer.
export function buildImpactEnvelope(damageAmount) {
  const clampedDamage = Math.max(0, damageAmount || 0);
  const frequency = Math.max(50, 380 - clampedDamage * 4.5);
  const duration = 0.06 + clampedDamage * 0.008;
  const amplitude = Math.min(1, 0.25 + clampedDamage * 0.015);
  const decaySeconds = 0.02 + clampedDamage * 0.002;

  return {
    frequency,
    duration,
    waveform: 'noise',
    attackSeconds: 0.001,
    decaySeconds,
    amplitude,
  };
}
