import { CHASSIS_MESH_DIMS } from './MechMesh.js';

// A flat cockpitHeight=2.7 previously put the camera dead-center inside the
// player's own torso box (medium torso spans world y 2.0-3.4, centered on
// the mech's own x/z axis with no forward offset) -- every torso/head/arm
// face culls as a back face from inside, but the postprocessing pipeline's
// SSAO/normal pre-pass still picked up that near-zero-distance interior
// geometry and rendered it as a solid black region filling most of the
// screen. Deriving cockpitHeight from the actual chassis dimensions (just
// above the top of the head) keeps the camera clear of all mesh geometry
// for every chassis, not just medium.
const COCKPIT_CLEARANCE_ABOVE_HEAD = 0.15;

function cockpitHeightForChassis(chassisType) {
  const dims = CHASSIS_MESH_DIMS[chassisType] || CHASSIS_MESH_DIMS.medium;
  return dims.legHeight + dims.torsoHeight + dims.headSize + COCKPIT_CLEARANCE_ABOVE_HEAD;
}

export function updateCameraFromMech(camera, mech, mechMeshHandle) {
  const cockpitHeight = cockpitHeightForChassis(mech.chassisType);
  camera.position.set(mech.position.x, mech.position.y + cockpitHeight, mech.position.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = mech.legYaw + mech.torsoYaw;
  camera.rotation.x = mech.pitch;

  mechMeshHandle.root.position.set(mech.position.x, mech.position.y, mech.position.z);
  mechMeshHandle.root.rotation.y = mech.legYaw;
  mechMeshHandle.torsoGroup.rotation.y = mech.torsoYaw;
}
