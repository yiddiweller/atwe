import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

/**
 * The feel of the app, in one place.
 *
 * Every tap, tick and confirmation in Atwe goes through here rather than
 * calling expo-haptics directly, for three reasons that all show up as
 * *sloppiness* when they are ignored:
 *
 *  1. ONE VOCABULARY. Six named intents, each mapped to exactly one of Apple's
 *     generators. A screen chooses what it MEANS — a press, a tick, a success —
 *     and never picks an intensity. That is what stops one button feeling
 *     heavier than the identical button on the next screen.
 *
 *  2. NOTHING RUNS TOGETHER. The Taptic Engine cannot separate two events fired
 *     within a few tens of milliseconds: they merge into one long buzz, which is
 *     the exact opposite of crisp. `MIN_GAP` coalesces them, so a fast scrub
 *     through a picker ticks cleanly instead of humming, and a component that
 *     accidentally fires twice for one gesture still feels like one click.
 *
 *  3. IT CAN NEVER BREAK ANYTHING. Every call is fire-and-forget and swallows
 *     its own errors. A device without a Taptic Engine, a simulator, the web
 *     build — all of them silently do nothing rather than throwing inside a
 *     press handler.
 *
 * WHEN it fires matters as much as which one. A real button clicks as it goes
 * DOWN, not when your finger leaves — so presses fire on `onPressIn`, and only
 * completions (a success, a failure) fire at the end of the work.
 */

/**
 * Two haptics closer together than this are felt as one long vibration rather
 * than two clicks. 45ms is comfortably under the fastest a person can tap the
 * same control twice and comfortably over the Engine's own settling time.
 */
const MIN_GAP = 45;

/** Haptics are an iOS/Android idea; on web the calls are no-ops anyway, but
 *  there is no reason to schedule them at all. */
const SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

let last = 0;
let enabled = true;

function fire(run: () => Promise<void>) {
  if (!enabled || !SUPPORTED) return;
  const now = Date.now();
  if (now - last < MIN_GAP) return;   // would merge into the previous one
  last = now;
  run().catch(() => {});              // no device, no engine, no problem
}

export const haptics = {
  /**
   * A button going down. The default for anything you PRESS — a primary action,
   * a toggle, a menu row, a card that opens something.
   *
   * Light on purpose: a heavier one on every tap is what makes an app feel
   * cheap and buzzy rather than mechanical.
   */
  tap() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },

  /**
   * A deliberate, weightier act that is about to change something in the world:
   * starting a recording, paying, going live. Rare by design — if everything is
   * heavy, nothing is.
   */
  press() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },

  /**
   * The microscopic tick of a value changing: stepping a quantity, moving
   * between tabs, picking a chip, a caret landing in a field, a character
   * coming back out of one. Apple's own picker-wheel feel.
   */
  select() {
    fire(() => Haptics.selectionAsync());
  },

  /** It worked: a form landed, money moved, an order was placed. */
  success() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },

  /** Careful: a destructive confirmation is being offered, or something needs
   *  attention before it can go ahead. */
  warning() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },

  /** It failed, or was refused. */
  error() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },

  /** Turn the whole thing off (Settings → Appearance → Haptics). Off means off:
   *  nothing is queued while disabled, so re-enabling never lets a backlog out.
   *  The choice is remembered on the device. */
  setEnabled(on: boolean) {
    enabled = on;
    store.set(on ? 'on' : 'off').catch(() => {});
  },
  get isEnabled() {
    return enabled;
  },
};

/* ---------------------------------------------------------------------------
   Remembering the choice.

   Some people find any vibration unpleasant, and iOS's own system switch is
   buried; an app this tactile owes them a one-tap way out. Stored beside the
   theme preference, with the same web fallback — expo-secure-store has no web
   implementation and throws there, which is not worth losing a preference for.
   --------------------------------------------------------------------------- */
const PREF_KEY = 'atwe_haptics';

const store = {
  get: async (): Promise<string | null> => {
    if (Platform.OS === 'web') { try { return localStorage.getItem(PREF_KEY); } catch { return null; } }
    return SecureStore.getItemAsync(PREF_KEY);
  },
  set: async (v: string) => {
    if (Platform.OS === 'web') { try { localStorage.setItem(PREF_KEY, v); } catch { /* private mode */ } return; }
    await SecureStore.setItemAsync(PREF_KEY, v);
  },
};

/** Read the saved choice once at boot. Defaults to ON — the app is meant to be
 *  felt; silence is the deliberate opt-out, not the default. */
export async function loadHapticPref(): Promise<boolean> {
  try {
    const v = await store.get();
    enabled = v !== 'off';
  } catch { /* keep the default */ }
  return enabled;
}

/**
 * Text fields: a tick as the caret lands, and a tick as a character comes back
 * out — the two moments a person is moving through text rather than adding to
 * it. Typing FORWARD is deliberately silent: iOS already gives the keyboard its
 * own feedback, and a second one per keystroke is the muddy buzz this whole
 * module exists to avoid.
 *
 *   const t = useHapticText(value);
 *   <TextInput value={value} onChangeText={t.onChangeText(setValue)} onFocus={t.onFocus} />
 *
 * Or just use <HapticInput>, which wires both for you.
 */
export function textHaptics() {
  return {
    onFocus: () => haptics.select(),
    /** Wrap a setter: ticks only when the text got SHORTER. */
    onChangeText: (set: (t: string) => void, previous: string) => (next: string) => {
      if (next.length < previous.length) haptics.select();
      set(next);
    },
  };
}
