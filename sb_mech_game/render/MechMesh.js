import * as THREE from 'three';

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
const CHASSIS_MESH_DIMS = {
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

export function createPlaceholderMechMesh(chassisType = 'medium') {
  const dims = CHASSIS_MESH_DIMS[chassisType] ?? CHASSIS_MESH_DIMS.medium;

  const root = new THREE.Group();

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(dims.legWidth, dims.legHeight, dims.legWidth),
    legMaterial,
  );
  leftLeg.position.set(-dims.legOffsetX, dims.legHeight / 2, 0);
  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(dims.legWidth, dims.legHeight, dims.legWidth),
    legMaterial,
  );
  rightLeg.position.set(dims.legOffsetX, dims.legHeight / 2, 0);
  root.add(leftLeg, rightLeg);

  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, dims.legHeight, 0);
  root.add(torsoGroup);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(dims.torsoWidth, dims.torsoHeight, dims.torsoDepth),
    new THREE.MeshStandardMaterial({ color: 0x777788 }),
  );
  torso.position.set(0, dims.torsoHeight / 2, 0);
  torsoGroup.add(torso);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(dims.headSize, dims.headSize, dims.headSize),
    new THREE.MeshStandardMaterial({ color: 0x99aabb }),
  );
  head.position.set(0, dims.torsoHeight + dims.headSize / 2, 0);
  torsoGroup.add(head);

  const armMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(dims.armWidth, dims.armHeight, dims.armWidth),
    armMaterial,
  );
  leftArm.position.set(-dims.armOffsetX, dims.armHeight / 2, 0);
  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(dims.armWidth, dims.armHeight, dims.armWidth),
    armMaterial,
  );
  rightArm.position.set(dims.armOffsetX, dims.armHeight / 2, 0);
  torsoGroup.add(leftArm, rightArm);

  for (const mesh of [leftLeg, rightLeg, torso, head, leftArm, rightArm]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  return { root, torsoGroup };
}
