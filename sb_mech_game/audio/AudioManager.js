// AudioContext wiring/glue. Kept separate from SoundSynth.js so the pure
// envelope-generation logic stays unit-testable without a real AudioContext.
//
// Autoplay-policy note: createAudioManager() constructs the AudioContext
// synchronously when called, but does NOT create it eagerly at module load
// time (this module has zero top-level side effects). Integration is
// expected to call createAudioManager()/resumeAudioContext() from inside
// the existing "click to start" overlay click handler in main.js /
// InputManager.js, i.e. in direct response to a user gesture, so the
// browser doesn't silently suspend it.

import { buildWeaponFireEnvelope, buildImpactEnvelope } from './SoundSynth.js';

const AMBIENT_GAIN_LEVEL = 0.12;
const HEAT_WARNING_BEEP = {
  frequency: 880,
  duration: 0.12,
  waveform: 'square',
  attackSeconds: 0.005,
  decaySeconds: 0.05,
  amplitude: 0.7,
};
const FOOTSTEP_ENVELOPE = {
  frequency: 120,
  duration: 0.05,
  waveform: 'noise',
  attackSeconds: 0.001,
  decaySeconds: 0.03,
  amplitude: 0.35,
};

function getAudioContextClass() {
  return window.AudioContext || window.webkitAudioContext;
}

function createNoiseBuffer(context, duration) {
  const sampleRate = context.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createSourceNodeForEnvelope(context, envelope, totalDuration) {
  if (envelope.waveform === 'noise') {
    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context, totalDuration);
    return source;
  }
  const oscillator = context.createOscillator();
  oscillator.type = envelope.waveform;
  oscillator.frequency.setValueAtTime(envelope.frequency, context.currentTime);
  return oscillator;
}

function setPannerPosition(panner, context, position) {
  if (panner.positionX) {
    panner.positionX.setValueAtTime(position.x, context.currentTime);
    panner.positionY.setValueAtTime(position.y, context.currentTime);
    panner.positionZ.setValueAtTime(position.z, context.currentTime);
  } else if (panner.setPosition) {
    panner.setPosition(position.x, position.y, position.z);
  }
}

function createPannerAt(context, position) {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 5;
  panner.maxDistance = 300;
  panner.rolloffFactor = 1.2;
  setPannerPosition(panner, context, position);
  return panner;
}

// Plays a single one-shot envelope (oscillator or noise burst), optionally
// positioned in 3D via a PannerNode when sourcePosition is given.
function playEnvelope(audioManager, envelope, sourcePosition) {
  const { context, masterGain } = audioManager;
  const now = context.currentTime;
  const totalDuration = envelope.attackSeconds + envelope.decaySeconds + envelope.duration;
  const peakGain = envelope.amplitude !== undefined ? envelope.amplitude : 0.7;

  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(peakGain, now + envelope.attackSeconds);
  gainNode.gain.linearRampToValueAtTime(
    0,
    now + envelope.attackSeconds + envelope.decaySeconds + envelope.duration,
  );

  const sourceNode = createSourceNodeForEnvelope(context, envelope, totalDuration + 0.05);
  sourceNode.connect(gainNode);

  if (sourcePosition) {
    const panner = createPannerAt(context, sourcePosition);
    gainNode.connect(panner);
    panner.connect(masterGain);
  } else {
    gainNode.connect(masterGain);
  }

  sourceNode.start(now);
  sourceNode.stop(now + totalDuration + 0.05);
}

export function createAudioManager(listenerMech) {
  const AudioContextClass = getAudioContextClass();
  const context = new AudioContextClass();

  const masterGain = context.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(context.destination);

  const audioManager = {
    context,
    masterGain,
    listenerMech: listenerMech || null,
    ambient: { source: null, gain: null },
    heatWarningTimerId: null,
  };

  if (listenerMech) {
    updateListener(audioManager, listenerMech);
  }

  return audioManager;
}

// Resumes a suspended AudioContext. Browsers create AudioContexts in a
// "suspended" state until a user gesture; call this from the same click
// handler used to acquire pointer lock.
export function resumeAudioContext(audioManager) {
  if (audioManager.context.state === 'suspended') {
    return audioManager.context.resume();
  }
  return Promise.resolve();
}

export function updateListener(audioManager, listenerMech) {
  if (!listenerMech) return;
  const { context } = audioManager;
  const listener = context.listener;
  const { position } = listenerMech;
  const yaw = (listenerMech.legYaw || 0) + (listenerMech.torsoYaw || 0);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);

  if (listener.positionX) {
    listener.positionX.setValueAtTime(position.x, context.currentTime);
    listener.positionY.setValueAtTime(position.y, context.currentTime);
    listener.positionZ.setValueAtTime(position.z, context.currentTime);
    listener.forwardX.setValueAtTime(forwardX, context.currentTime);
    listener.forwardY.setValueAtTime(0, context.currentTime);
    listener.forwardZ.setValueAtTime(forwardZ, context.currentTime);
    listener.upX.setValueAtTime(0, context.currentTime);
    listener.upY.setValueAtTime(1, context.currentTime);
    listener.upZ.setValueAtTime(0, context.currentTime);
  } else if (listener.setPosition) {
    listener.setPosition(position.x, position.y, position.z);
    listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
  }

  audioManager.listenerMech = listenerMech;
}

export function playWeaponFire(audioManager, weaponType, sourcePosition) {
  const envelope = buildWeaponFireEnvelope(weaponType);
  playEnvelope(audioManager, envelope, sourcePosition);
}

// damageAmount is an optional third argument (beyond the base interface
// contract) so the impact's loudness/pitch can scale via buildImpactEnvelope;
// it defaults to a mid-sized hit when the caller doesn't have a damage value
// handy.
export function playImpact(audioManager, sourcePosition, damageAmount = 15) {
  const envelope = buildImpactEnvelope(damageAmount);
  playEnvelope(audioManager, envelope, sourcePosition);
}

// Non-positional: this is the player's own overheat alarm, always audible
// regardless of where anything is in the world. Two quick beeps.
export function playHeatWarning(audioManager) {
  playEnvelope(audioManager, HEAT_WARNING_BEEP, null);
  const { context } = audioManager;
  const secondBeepDelayMs = (HEAT_WARNING_BEEP.attackSeconds + HEAT_WARNING_BEEP.decaySeconds
    + HEAT_WARNING_BEEP.duration + 0.08) * 1000;
  audioManager.heatWarningTimerId = setTimeout(() => {
    audioManager.heatWarningTimerId = null;
    if (context.state !== 'closed') {
      playEnvelope(audioManager, HEAT_WARNING_BEEP, null);
    }
  }, secondBeepDelayMs);
}

export function playFootstep(audioManager, sourcePosition) {
  playEnvelope(audioManager, FOOTSTEP_ENVELOPE, sourcePosition);
}

// Looping wind/battlefield ambience bed, positionless (connected straight to
// masterGain, no PannerNode). Idempotent: calling it again while the loop is
// already running is a no-op rather than stacking layers.
export function playAmbientLoop(audioManager) {
  if (audioManager.ambient.source) return;

  const { context, masterGain } = audioManager;
  const bufferDuration = 4;
  const noiseSource = context.createBufferSource();
  noiseSource.buffer = createNoiseBuffer(context, bufferDuration);
  noiseSource.loop = true;

  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 400;

  const ambientGain = context.createGain();
  ambientGain.gain.value = AMBIENT_GAIN_LEVEL;

  noiseSource.connect(lowpass);
  lowpass.connect(ambientGain);
  ambientGain.connect(masterGain);
  noiseSource.start();

  audioManager.ambient.source = noiseSource;
  audioManager.ambient.gain = ambientGain;
}

// Stops the ambient loop (if running) and cancels any pending heat-warning
// second-beep timer. Call this when a match ends (team elimination) so audio
// doesn't keep playing after the game is over.
export function stopAmbientLoop(audioManager) {
  if (audioManager.ambient.source) {
    audioManager.ambient.source.stop();
    audioManager.ambient.source = null;
    audioManager.ambient.gain = null;
  }
  if (audioManager.heatWarningTimerId !== null) {
    clearTimeout(audioManager.heatWarningTimerId);
    audioManager.heatWarningTimerId = null;
  }
}
