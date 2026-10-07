import { useCallback } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSharedValue, withTiming, Easing, type SharedValue } from 'react-native-reanimated';

/**
 * The top chrome gets out of the way.
 *
 * Scroll down and the bar slides up and off; scroll back up and it returns —
 * the same thing the web's top bar does, and the counterpart to iOS 26 taking
 * the tab bar away at the bottom. It is what makes a screen give its WHOLE
 * height to the content: the founder's complaint was a story tray sliced in
 * half by a band that never moved.
 *
 * What slides is the bar's CONTENT, not the bar: the safe-area strip stays put
 * so the clock never sits on a photo. `ChromeBar` does that arithmetic from its
 * own measured height, so a screen only has to hand its scroll events over.
 *
 * The thresholds are a few points rather than zero on purpose — a finger is
 * never perfectly still, and a bar that flips on a 1pt wobble reads as a fault.
 */
export interface ChromeRetract {
  /** 0 = fully shown, 1 = fully gone. */
  hidden: SharedValue<number>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

const AWAY = { duration: 260, easing: Easing.out(Easing.cubic) };
const BACK = { duration: 200, easing: Easing.out(Easing.cubic) };
/** How far the finger must travel before the bar commits either way. */
const TOL = 6;

export function useChromeRetract(): ChromeRetract {
  const hidden = useSharedValue(0);
  const lastY = useSharedValue(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.value;
    lastY.value = y;
    // Pinned open at the top: there is nothing above to reveal.
    if (y <= 4) {
      if (hidden.value !== 0) hidden.value = withTiming(0, BACK);
      return;
    }
    if (dy > TOL && hidden.value !== 1) hidden.value = withTiming(1, AWAY);
    else if (dy < -TOL && hidden.value !== 0) hidden.value = withTiming(0, BACK);
  }, [hidden, lastY]);

  return { hidden, onScroll };
}
