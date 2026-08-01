export function updateCameraFromMech(camera, mech, mechMeshHandle) {
  const cockpitHeight = 2.7;
  camera.position.set(mech.position.x, mech.position.y + cockpitHeight, mech.position.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = mech.legYaw + mech.torsoYaw;
  camera.rotation.x = mech.pitch;

  mechMeshHandle.root.position.set(mech.position.x, mech.position.y, mech.position.z);
  mechMeshHandle.root.rotation.y = mech.legYaw;
  mechMeshHandle.torsoGroup.rotation.y = mech.torsoYaw;
}
