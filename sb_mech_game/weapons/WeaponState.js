import { addHeat } from '../mech/MechState.js';
import {
  LASER_DPS, LASER_HEAT_PER_SECOND,
  AC_DAMAGE_PER_SHOT, AC_HEAT_PER_SHOT, AC_COOLDOWN, AC_PROJECTILE_SPEED, AC_MAX_AMMO,
  MISSILE_DAMAGE_PER_MISSILE, MISSILE_COUNT_PER_VOLLEY, MISSILE_HEAT_PER_VOLLEY,
  MISSILE_COOLDOWN, MISSILE_LOCK_TIME, MISSILE_SPLASH_RADIUS, MISSILE_MAX_AMMO,
} from './WeaponConstants.js';

export function createWeapon(type) {
  let ammoRemaining = Infinity;
  if (type === 'autocannon') ammoRemaining = AC_MAX_AMMO;
  if (type === 'missile') ammoRemaining = MISSILE_MAX_AMMO;
  return { type, cooldownRemaining: 0, ammoRemaining, lockDwell: 0 };
}

export function canFire(weapon) {
  return weapon.cooldownRemaining <= 0 && weapon.ammoRemaining > 0;
}

export function tickCooldown(weapon, dt) {
  weapon.cooldownRemaining = Math.max(0, weapon.cooldownRemaining - dt);
}

// Laser has no cooldown/ammo gate at all -- it is purely heat-limited, so it
// always fires when called; the caller (AI/Integration) is responsible for
// deciding whether it's appropriate to call this each tick (e.g. respecting
// mech.shutdown).
export function fireLaserTick(weapon, mech, dt) {
  addHeat(mech, LASER_HEAT_PER_SECOND * dt);
  return LASER_DPS * dt;
}

export function fireAutocannon(weapon, mech) {
  if (weapon.type !== 'autocannon' || !canFire(weapon)) return null;
  weapon.ammoRemaining -= 1;
  weapon.cooldownRemaining = AC_COOLDOWN;
  addHeat(mech, AC_HEAT_PER_SHOT);
  return { damage: AC_DAMAGE_PER_SHOT, projectileSpeed: AC_PROJECTILE_SPEED };
}

// Note: ammoRemaining counts VOLLEYS, not individual missiles -- MISSILE_MAX_AMMO(24)
// volleys x MISSILE_COUNT_PER_VOLLEY(6) missiles = 144 missiles fired over the
// weapon's life. HUD/Integration should label this "24 volleys", not "24 missiles".
export function fireMissileVolley(weapon, mech) {
  if (weapon.type !== 'missile' || !canFire(weapon) || weapon.lockDwell < MISSILE_LOCK_TIME) return null;
  weapon.ammoRemaining -= 1;
  weapon.cooldownRemaining = MISSILE_COOLDOWN;
  addHeat(mech, MISSILE_HEAT_PER_VOLLEY);
  return {
    missileCount: MISSILE_COUNT_PER_VOLLEY,
    damagePerMissile: MISSILE_DAMAGE_PER_MISSILE,
    splashRadius: MISSILE_SPLASH_RADIUS,
  };
}

export function updateMissileLock(weapon, dt, targetInReticle) {
  if (targetInReticle) {
    weapon.lockDwell += dt;
  } else {
    weapon.lockDwell = 0;
  }
  return weapon.lockDwell >= MISSILE_LOCK_TIME;
}
