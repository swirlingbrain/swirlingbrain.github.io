import * as THREE from 'three';

export function createPlaceholderMechMesh() {
  const root = new THREE.Group();

  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.6), legMaterial);
  leftLeg.position.set(-0.5, 1, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.6), legMaterial);
  rightLeg.position.set(0.5, 1, 0);
  root.add(leftLeg, rightLeg);

  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 2, 0);
  root.add(torsoGroup);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.4, 1),
    new THREE.MeshStandardMaterial({ color: 0x777788 }),
  );
  torso.position.set(0, 0.7, 0);
  torsoGroup.add(torso);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x99aabb }),
  );
  head.position.set(0, 1.65, 0);
  torsoGroup.add(head);

  const armMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), armMaterial);
  leftArm.position.set(-1.1, 0.6, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), armMaterial);
  rightArm.position.set(1.1, 0.6, 0);
  torsoGroup.add(leftArm, rightArm);

  for (const mesh of [leftLeg, rightLeg, torso, head, leftArm, rightArm]) {
    mesh.castShadow = true;
  }

  return { root, torsoGroup };
}
