// Visible weapon effects: laser beams, autocannon/missile tracers, impact
// flashes, and death explosions. Previously the game had zero visual
// feedback for firing or destruction (only damage numbers + audio) -- real
// user playtesting confirmed this made combat unintelligible ("can't see
// any lasers or bullets... aimless wandering", "no mechs blow up or
// anything"). This module is intentionally simple (THREE.Line tracers and
// billboard-less spheres, not real particle systems) but gives every weapon
// type and every kill a real, visible moment.

import * as THREE from 'three';

const WEAPON_COLORS = {
  laser: 0x66ffee,
  autocannon: 0xffe066,
  missile: 0xff9933,
};

const BEAM_HEIGHT_OFFSET = 2; // roughly torso/weapon height above a mech's position

// Continuous laser beams: keyed by firing mech id so each mech's beam can be
// rebuilt/cleared every tick without leaking previous frames' lines.
const activeBeams = new Map();

// One-shot effects (tracers, impact flashes, explosions) that fade/expire
// over real simulation time via updateWeaponVfx(dt), not wall-clock timers,
// so they stay in sync with the rest of the tick-driven game and can't leak
// timers if the match ends abruptly.
const activeEffects = [];

function makeLine(fromPos, toPos, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(fromPos.x, fromPos.y + BEAM_HEIGHT_OFFSET, fromPos.z),
    new THREE.Vector3(toPos.x, toPos.y + BEAM_HEIGHT_OFFSET, toPos.z),
  ]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  return new THREE.Line(geometry, material);
}

/** Call every tick a mech is actively laser-firing, with isFiring=true; call with isFiring=false (or on death) to clear its beam. */
export function updateLaserBeam(scene, mechId, fromPos, toPos, isFiring) {
  const existing = activeBeams.get(mechId);
  if (existing) {
    scene.remove(existing);
    existing.geometry.dispose();
    existing.material.dispose();
    activeBeams.delete(mechId);
  }
  if (!isFiring) return;
  const line = makeLine(fromPos, toPos, WEAPON_COLORS.laser);
  scene.add(line);
  activeBeams.set(mechId, line);
}

export function clearLaserBeam(scene, mechId) {
  updateLaserBeam(scene, mechId, null, null, false);
}

/** One-shot tracer line for a single-instant weapon (autocannon shot, missile volley launch). */
export function spawnTracer(scene, fromPos, toPos, weaponType, durationSeconds = 0.12) {
  const line = makeLine(fromPos, toPos, WEAPON_COLORS[weaponType] || 0xffffff);
  scene.add(line);
  activeEffects.push({
    mesh: line, remaining: durationSeconds, totalDuration: durationSeconds, growing: false,
  });
}

/** Small bright flash where a shot actually lands. */
export function spawnImpactFlash(scene, position, sizeScale = 1) {
  const geometry = new THREE.SphereGeometry(0.35 * sizeScale, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y + BEAM_HEIGHT_OFFSET, position.z);
  scene.add(mesh);
  activeEffects.push({
    mesh, remaining: 0.15, totalDuration: 0.15, growing: true, growthRate: 4,
  });
}

/** Bigger expanding flash for a mech's destruction. */
export function spawnExplosion(scene, position) {
  const geometry = new THREE.SphereGeometry(1.1, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y + BEAM_HEIGHT_OFFSET, position.z);
  scene.add(mesh);
  activeEffects.push({
    mesh, remaining: 0.7, totalDuration: 0.7, growing: true, growthRate: 5,
  });
}

/** Call once per tick to age out and remove expired one-shot effects. */
export function updateWeaponVfx(scene, dt) {
  for (let i = activeEffects.length - 1; i >= 0; i -= 1) {
    const effect = activeEffects[i];
    effect.remaining -= dt;
    if (effect.growing) {
      effect.mesh.scale.multiplyScalar(1 + effect.growthRate * dt);
    }
    effect.mesh.material.opacity = Math.max(0, effect.remaining / effect.totalDuration);
    if (effect.remaining <= 0) {
      scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
      activeEffects.splice(i, 1);
    }
  }
}
