export function createWorld() {
  return { mechs: [] };
}

export function addMech(world, mech) {
  world.mechs.push(mech);
  return mech;
}
