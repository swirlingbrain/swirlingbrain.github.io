// Visible weapon effects: laser beams, autocannon/missile tracers, impact
// flashes, and death explosions. Previously the game had zero visual
// feedback for firing or destruction (only damage numbers + audio) -- real
// user playtesting confirmed this made combat unintelligible ("can't see
// any lasers or bullets... aimless wandering", "no mechs blow up or
// anything"). Beams/tracers are thin emissive cylinders rather than
// THREE.Line: WebGL line width is capped at 1px on most platforms/GPUs
// regardless of the material's linewidth setting, so a "line" would have
// been nearly invisible on many machines -- a real cylinder has actual
// screen-space thickness and picks up bloom via its emissive-equivalent
// bright unlit color.

import * as THREE from 'three';

const WEAPON_COLORS = {
  laser: 0x66ffee,
  autocannon: 0xffe066,
  missile: 0xff9933,
};

const BEAM_RADII = {
  laser: 0.05,
  autocannon: 0.045,
  missile: 0.07,
};

const BEAM_HEIGHT_OFFSET = 2; // roughly torso/weapon height above a mech's position
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Continuous laser beams: keyed by firing mech id so each mech's beam can be
// rebuilt/cleared every tick without leaking previous frames' geometry.
const activeBeams = new Map();

// One-shot effects (tracers, impact flashes, explosions) that fade/expire
// over real simulation time via updateWeaponVfx(dt), not wall-clock timers,
// so they stay in sync with the rest of the tick-driven game and can't leak
// timers if the match ends abruptly.
const activeEffects = [];

/** A thin bright cylinder spanning two world points -- a "beam" with real screen-space thickness. */
function makeBeamMesh(fromPos, toPos, color, radius) {
  const from = new THREE.Vector3(fromPos.x, fromPos.y + BEAM_HEIGHT_OFFSET, fromPos.z);
  const to = new THREE.Vector3(toPos.x, toPos.y + BEAM_HEIGHT_OFFSET, toPos.z);
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(direction.length(), 0.01);

  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6, 1, true);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP_AXIS, direction.normalize());
  return mesh;
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
  const beam = makeBeamMesh(fromPos, toPos, WEAPON_COLORS.laser, BEAM_RADII.laser);
  scene.add(beam);
  activeBeams.set(mechId, beam);
}

export function clearLaserBeam(scene, mechId) {
  updateLaserBeam(scene, mechId, null, null, false);
}

/** One-shot tracer beam for a single-instant weapon (autocannon shot, missile volley launch). */
export function spawnTracer(scene, fromPos, toPos, weaponType, durationSeconds = 0.12) {
  const beam = makeBeamMesh(fromPos, toPos, WEAPON_COLORS[weaponType] || 0xffffff, BEAM_RADII[weaponType] || 0.05);
  scene.add(beam);
  activeEffects.push({
    mesh: beam, remaining: durationSeconds, totalDuration: durationSeconds, growing: false,
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
