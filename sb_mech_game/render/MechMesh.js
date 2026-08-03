import * as THREE from 'three';
import { createMetalMaterial } from './ProceduralTextures.js';

// Per-chassis mesh proportions. Derived from the approved HUD/chassis mockup
// (docs/superpowers/specs/2026-08-01-mech-shooter-design.md "HUD / Visual
// Direction" -> mockup artifact's chassis-silhouette SVGs), converting the
// mockup's flat 2D silhouette proportions into 3D box dimensions relative to
// the Phase 0 medium baseline. `medium` MUST stay exactly equal to Phase 0's
// original hardcoded placeholder dimensions (legWidth 0.6, legHeight 2,
// legOffsetX 0.5, torsoWidth 1.6, torsoHeight 1.4, torsoDepth 1, headSize
// 0.5, armWidth 0.4, armHeight 1.2, armOffsetX 1.1) so the default/medium
// case is an exact no-regression match with Phase 0.
//
// Notable relative-proportion facts baked into these numbers (matching the
// mockup): light has the tallest leg-to-torso height ratio (tall legs, short
// torso) while assault has the lowest (bulky torso dominates); torso width
// grows the most dramatically across the light -> assault range, which is
// the primary silhouette read at a glance.
export const CHASSIS_MESH_DIMS = {
  light: {
    legWidth: 0.5, legHeight: 1.91, legOffsetX: 0.39,
    torsoWidth: 1.28, torsoHeight: 1.25, torsoDepth: 0.8,
    headSize: 0.43,
    armWidth: 0.31, armHeight: 0.98, armOffsetX: 0.92,
  },
  medium: {
    legWidth: 0.6, legHeight: 2.0, legOffsetX: 0.5,
    torsoWidth: 1.6, torsoHeight: 1.4, torsoDepth: 1.0,
    headSize: 0.5,
    armWidth: 0.4, armHeight: 1.2, armOffsetX: 1.1,
  },
  heavy: {
    legWidth: 0.75, legHeight: 2.09, legOffsetX: 0.69,
    torsoWidth: 2.08, torsoHeight: 1.55, torsoDepth: 1.3,
    headSize: 0.62,
    armWidth: 0.52, armHeight: 1.35, armOffsetX: 1.42,
  },
  assault: {
    legWidth: 0.9, legHeight: 2.18, legOffsetX: 0.95,
    torsoWidth: 2.72, torsoHeight: 1.7, torsoDepth: 1.7,
    headSize: 0.75,
    armWidth: 0.62, armHeight: 1.5, armOffsetX: 1.6,
  },
};

// Accent color (visor/vent/stripe) is keyed by TEAM, not chassis weight
// class -- real playtesting reported it was "hard to tell which mechs are
// friends or foes," and the previous per-chassis accent color was the
// direct cause: an allied medium and an enemy medium rendered with the
// identical cyan accent, since chassis type has no relationship to team.
// These match the radar's existing team colors (Hud.js's updateRadar) so
// the color language is consistent everywhere on screen, not just here.
// Legs/torso/arms still use the same gunmetal-family metal material across
// all chassis/teams (per the design's "shared material language" intent).
const TEAM_ACCENT_COLOR = {
  allies: 0x3ddc71,
  enemies: 0xff3b3b,
};
const DEFAULT_ACCENT_COLOR = 0x7fe7ff;

const materialCacheByKey = new Map();
function getMaterialsForChassis(chassisType, team) {
  const cacheKey = `${chassisType}:${team}`;
  if (materialCacheByKey.has(cacheKey)) return materialCacheByKey.get(cacheKey);
  // Seeds vary per part so the same chassis's leg/torso/arm textures aren't
  // literally identical tiling, while staying deterministic (no Math.random).
  const seedBase = Array.from(chassisType).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const accentColor = TEAM_ACCENT_COLOR[team] ?? DEFAULT_ACCENT_COLOR;
  const materials = {
    leg: createMetalMaterial(0x4a4d52, seedBase + 1),
    torso: createMetalMaterial(0x5c6068, seedBase + 2),
    head: createMetalMaterial(0x6b7078, seedBase + 3),
    arm: createMetalMaterial(0x45484d, seedBase + 4),
    barrel: createMetalMaterial(0x2b2d30, seedBase + 5),
    accent: new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.4,
    }),
  };
  materialCacheByKey.set(cacheKey, materials);
  return materials;
}

export function createPlaceholderMechMesh(chassisType = 'medium', team = 'allies') {
  const dims = CHASSIS_MESH_DIMS[chassisType] ?? CHASSIS_MESH_DIMS.medium;
  const mats = getMaterialsForChassis(CHASSIS_MESH_DIMS[chassisType] ? chassisType : 'medium', team);

  const root = new THREE.Group();

  // Each leg hangs off a "hip pivot" group positioned at the top of the leg
  // (matching torsoGroup's height) rather than being added to root directly
  // -- rotating a pivot at the hip swings the whole leg+joint forward/back
  // for a walk cycle; rotating the leg mesh itself would pivot around its
  // own center and look like it's swinging from the knee. The leg mesh and
  // its joint greeble are children with a negative y offset so nothing
  // visually moves versus the previous non-rotating placement.
  const jointHeight = dims.legHeight * 0.12;
  const hipPivots = {};
  for (const legSign of [-1, 1]) {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(legSign * dims.legOffsetX, dims.legHeight, 0);
    root.add(hipPivot);

    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(dims.legWidth, dims.legHeight, dims.legWidth),
      mats.leg,
    );
    leg.position.set(0, -dims.legHeight / 2, 0);
    leg.castShadow = true;
    leg.receiveShadow = true;
    hipPivot.add(leg);

    // Small ankle/knee joint greeble so the leg doesn't read as one plain
    // extruded box -- a thin darker band partway up the leg.
    const joint = new THREE.Mesh(
      new THREE.BoxGeometry(dims.legWidth * 1.08, jointHeight, dims.legWidth * 1.08),
      mats.barrel,
    );
    joint.position.set(0, dims.legHeight * 0.42 - dims.legHeight, 0);
    joint.castShadow = true;
    joint.receiveShadow = true;
    hipPivot.add(joint);

    hipPivots[legSign] = hipPivot;
  }
  const leftHipPivot = hipPivots[-1];
  const rightHipPivot = hipPivots[1];

  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, dims.legHeight, 0);
  root.add(torsoGroup);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(dims.torsoWidth, dims.torsoHeight, dims.torsoDepth),
    mats.torso,
  );
  torso.position.set(0, dims.torsoHeight / 2, 0);
  torsoGroup.add(torso);

  // Vent/intake greeble on the torso back, plus a chassis-accent-colored
  // stripe on the front so the silhouette reads as "built," not a bare box,
  // and each weight class has a visible color identity beyond proportions.
  const vent = new THREE.Mesh(
    new THREE.BoxGeometry(dims.torsoWidth * 0.5, dims.torsoHeight * 0.35, dims.torsoDepth * 0.08),
    mats.barrel,
  );
  vent.position.set(0, dims.torsoHeight * 0.55, -dims.torsoDepth / 2 - 0.02);
  torsoGroup.add(vent);

  const accentStripe = new THREE.Mesh(
    new THREE.BoxGeometry(dims.torsoWidth * 0.85, dims.torsoHeight * 0.12, dims.torsoDepth * 0.06),
    mats.accent,
  );
  accentStripe.position.set(0, dims.torsoHeight * 0.78, dims.torsoDepth / 2 + 0.01);
  torsoGroup.add(accentStripe);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(dims.headSize, dims.headSize, dims.headSize),
    mats.head,
  );
  head.position.set(0, dims.torsoHeight + dims.headSize / 2, 0);
  torsoGroup.add(head);

  // Visor slit: a thin emissive accent band across the head, catching bloom.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(dims.headSize * 0.85, dims.headSize * 0.18, dims.headSize * 0.15),
    mats.accent,
  );
  visor.position.set(0, dims.torsoHeight + dims.headSize * 0.55, dims.headSize / 2 + 0.01);
  torsoGroup.add(visor);

  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(dims.armWidth, dims.armHeight, dims.armWidth),
    mats.arm,
  );
  leftArm.position.set(-dims.armOffsetX, dims.armHeight / 2, 0);
  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(dims.armWidth, dims.armHeight, dims.armWidth),
    mats.arm,
  );
  rightArm.position.set(dims.armOffsetX, dims.armHeight / 2, 0);
  torsoGroup.add(leftArm, rightArm);

  // Weapon barrel stubs on each forearm, pointing forward -- gives combat a
  // visible "this is where shots come from" point instead of an abstract
  // box, and matches WeaponVFX's beams/tracers actually originating near here.
  const barrelRadius = dims.armWidth * 0.28;
  const barrelLength = dims.armWidth * 1.6;
  for (const armSign of [-1, 1]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelLength, 10),
      mats.barrel,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(armSign * dims.armOffsetX, dims.armHeight * 0.75, dims.armWidth / 2 + barrelLength / 2);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    torsoGroup.add(barrel);
  }

  for (const mesh of [torso, head, leftArm, rightArm, vent, accentStripe, visor]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  return {
    root, torsoGroup, leftHipPivot, rightHipPivot,
  };
}
