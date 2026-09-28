import { File, Paths } from 'expo-file-system';
import { encode as encodeBase64 } from 'base-64';

import { initializeVoiceAudioAsync } from '@/lib/voice/speech-output';

export type WorkingSoundVariant = 'soft' | 'glass';

type ExpoAudioModule = typeof import('expo-av');
type AudioSound = import('expo-av').Audio.Sound;

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 1.8;
const PEAK_VOLUME = 0.12;

let audioModulePromise: Promise<ExpoAudioModule | null> | null = null;
let loadedVariant: WorkingSoundVariant | undefined;
let sound: AudioSound | undefined;
let playing = false;
let playbackGeneration = 0;
let playbackQueue: Promise<unknown> = Promise.resolve();

function queuePlayback<T>(operation: () => Promise<T>): Promise<T> {
  const next = playbackQueue.then(operation);
  playbackQueue = next.catch(() => undefined);
  return next;
}

async function releaseSoundAsync() {
  if (!sound) return;
  await sound.unloadAsync();
  sound = undefined;
  loadedVariant = undefined;
  playing = false;
}

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-av')
      .then((module) => module)
      .catch(() => null);
  }

  return audioModulePromise;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createEnvelope(progress: number) {
  if (progress < 0.18) {
    return progress / 0.18;
  }

  if (progress > 0.88) {
    return Math.max(0, (1 - progress) / 0.12);
  }

  return 1;
}

function createSample(time: number, variant: WorkingSoundVariant) {
  const progress = time / DURATION_SECONDS;
  const envelope = createEnvelope(progress);
  const sweep = Math.sin(progress * Math.PI);

  if (variant === 'glass') {
    const a = Math.sin(2 * Math.PI * 392 * time);
    const b = Math.sin(2 * Math.PI * 587.33 * time) * 0.55;
    return (a + b) * 0.5 * envelope * (0.55 + sweep * 0.45);
  }

  const a = Math.sin(2 * Math.PI * 261.63 * time);
  const b = Math.sin(2 * Math.PI * 329.63 * time) * 0.6;
  const c = Math.sin(2 * Math.PI * 392 * time) * 0.25;
  return (a + b + c) * 0.45 * envelope * (0.5 + sweep * 0.5);
}

function createWorkingSoundBase64(variant: WorkingSoundVariant) {
  const sampleCount = Math.floor(SAMPLE_RATE * DURATION_SECONDS);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const sample = clamp(createSample(time, variant) * PEAK_VOLUME, -1, 1);
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return encodeBase64(binary);
}

async function ensureWorkingSoundFileAsync(variant: WorkingSoundVariant) {
  const file = new File(Paths.cache, `working-sound-${variant}.wav`);
  if (!file.exists) {
    file.create();
    file.write(createWorkingSoundBase64(variant), { encoding: 'base64' });
  }

  return file.uri;
}

export function startWorkingSoundAsync(variant: WorkingSoundVariant, volume: number) {
  const generation = ++playbackGeneration;
  return queuePlayback(async () => {
    if (generation !== playbackGeneration) return false;
    const audioModule = await getAudioModuleAsync();
    if (!audioModule || generation !== playbackGeneration) return false;

    try {
      await initializeVoiceAudioAsync();
      if (generation !== playbackGeneration) return false;
      if (sound && loadedVariant !== variant) await releaseSoundAsync();
      if (generation !== playbackGeneration) return false;

      if (!sound) {
        const uri = await ensureWorkingSoundFileAsync(variant);
        if (generation !== playbackGeneration) return false;
        const created = await audioModule.Audio.Sound.createAsync(
          { uri },
          {
            isLooping: true,
            progressUpdateIntervalMillis: 1000,
            shouldPlay: false,
            volume: clamp(volume, 0, 1),
          },
        );
        sound = created.sound;
        loadedVariant = variant;
      }

      // Stop/unmount invalidates in-flight loads before they can begin playback.
      if (generation !== playbackGeneration) return false;
      await sound.setVolumeAsync(clamp(volume, 0, 1));
      if (generation !== playbackGeneration) return false;
      if (!playing) {
        playing = true;
        await sound.playAsync();
      }
      return generation === playbackGeneration;
    } catch (error) {
      await releaseSoundAsync().catch(() => undefined);
      throw error;
    }
  });
}

export function stopWorkingSoundAsync() {
  playbackGeneration += 1;
  return queuePlayback(async () => {
    if (!sound || !playing) return;
    try {
      await sound.pauseAsync();
      playing = false;
      await sound.setPositionAsync(0);
    } catch {
      await releaseSoundAsync();
    }
  });
}

export function unloadWorkingSoundAsync() {
  playbackGeneration += 1;
  return queuePlayback(releaseSoundAsync);
}
