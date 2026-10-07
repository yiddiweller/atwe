import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioRecorder,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';

/**
 * Voice notes — record one, hand back a data URL the send routes already accept.
 *
 * The backend has taken voice notes since long before the phone app: a message
 * carries `media` (a base64 data URL), `mediaKind: 'audio'` and `durationSec`,
 * and `cleanMedia` splits on the fixed `;base64,` marker precisely so an iOS
 * type with parameters (`audio/mp4; codecs="mp4a.40.2"`) survives. So there is
 * nothing new server-side — this is the missing half.
 */

/* Deliberately NOT one of expo-audio's two presets. HIGH_QUALITY is 128kbps
   stereo — four times the bytes for speech nobody can hear the difference in —
   and LOW_QUALITY drops iOS to AudioQuality.MIN, which is audibly rough. Mono
   at 48kbps is the voice-note setting every messaging app converges on: about
   6 KB a second, so the five-minute ceiling below lands near 1.8 MB (2.4 MB
   once base64'd) against a 16 MB server cap. */
const VOICE: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/mp4', bitsPerSecond: 48000 },
};

/** A voice note stops itself at five minutes rather than filling the disk. */
export const VOICE_MAX_SEC = 300;
/** Under a second is a mis-tap, not a message. */
const VOICE_MIN_SEC = 1;

export interface VoiceNote {
  /** What gets sent — the server stores media as a base64 data URL. */
  dataUrl: string;
  durationSec: number;
  /** The recording still on disk. The optimistic bubble plays THIS rather than
   *  the data URL: iOS's player will not reliably open a `data:` URI, and a
   *  megabytes-long string does not belong in a render tree either. */
  fileUri: string;
}

export type VoiceFail = 'denied' | 'too-short' | 'failed';

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(VOICE);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // The tick and the "was this cancelled" flag are refs, not state: `stop` reads
  // them after an await, and a state value captured before that await is stale.
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const clearTick = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };
  useEffect(() => clearTick, []);

  /** Ask for the microphone and start. Returns false if it could not begin. */
  const start = useCallback(async (): Promise<boolean> => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return false;
      // Without allowsRecording iOS refuses to route the mic; without
      // playsInSilentMode the note plays back silent for anyone whose ring
      // switch is off — which is most people, most of the time.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      cancelled.current = false;
      setSeconds(0);
      setRecording(true);
      clearTick();
      tick.current = setInterval(() => {
        setSeconds((s) => {
          const n = s + 1;
          // Stopping from inside the tick would need `stop` before it is
          // defined; the screen watches `seconds` and sends at the ceiling.
          return n > VOICE_MAX_SEC ? VOICE_MAX_SEC : n;
        });
      }, 1000);
      return true;
    } catch {
      setRecording(false);
      clearTick();
      return false;
    }
  }, [recorder]);

  /** Stop and hand back the note, or a reason it produced nothing. */
  const stop = useCallback(async (): Promise<VoiceNote | { fail: VoiceFail }> => {
    clearTick();
    setRecording(false);
    let uri: string | null = null;
    // The recorder's own clock is authoritative — the one-second tick above is
    // only what the timer on screen counts, and it drifts.
    const measured = Math.round(recorder.currentTime || 0);
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      return { fail: 'failed' };
    } finally {
      // Hand the audio session back, or every later sound in the app is routed
      // as if a recording were still in progress (quiet, earpiece-only on iOS).
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        .catch(() => {});
    }
    if (cancelled.current) return { fail: 'too-short' };
    if (!uri) return { fail: 'failed' };
    const durationSec = Math.max(measured, seconds);
    if (durationSec < VOICE_MIN_SEC) return { fail: 'too-short' };
    try {
      const base64 = await new File(uri).base64();
      if (!base64) return { fail: 'failed' };
      return { dataUrl: `data:audio/mp4;base64,${base64}`, durationSec, fileUri: uri };
    } catch {
      return { fail: 'failed' };
    }
  }, [recorder, seconds]);

  /** Throw the recording away — the same stop, with nothing handed back. */
  const cancel = useCallback(async () => {
    cancelled.current = true;
    clearTick();
    setRecording(false);
    try {
      await recorder.stop();
    } catch {
      /* already stopped; nothing to undo */
    }
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }, [recorder]);

  return { recording, seconds, start, stop, cancel };
}

/** mm:ss — a voice note is always short enough that hours never appear. */
export function voiceTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What to tell someone when a recording produced nothing. `too-short` says
 *  nothing at all — they let go straight away, which was the whole message. */
export function voiceFailMessage(f: VoiceFail): string | null {
  if (f === 'denied') return 'Atwe needs microphone access to record a voice note. You can turn it on in Settings.';
  if (f === 'failed') return "That recording couldn't be saved. Please try again.";
  return null;
}
