export function computeMovementInputs(keysDown) {
  let throttleInput = 0;
  let legTurnInput = 0;
  if (keysDown.has('KeyW')) throttleInput += 1;
  if (keysDown.has('KeyS')) throttleInput -= 1;
  if (keysDown.has('KeyD')) legTurnInput -= 1;
  if (keysDown.has('KeyA')) legTurnInput += 1;
  return { throttleInput, legTurnInput };
}
