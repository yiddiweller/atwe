import { useState, useCallback } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { radius } from '@/theme/tokens';

/**
 * A bubble is a capsule on one line and squarer the moment it is two.
 *
 * ONE FIXED RADIUS CANNOT DO BOTH, and that is why this exists. iOS clamps a
 * corner to half the shorter side, so a one-line bubble (41pt tall) is only a
 * true capsule at 20.5 or more — and any value that high leaves a two-line
 * bubble (62pt) looking like a lozenge with semicircular ends, which is exactly
 * what the founder rejected twice. So the shape follows the box: capsule while
 * it is one line, `radius.bubble` once it is more.
 *
 * The first render guesses from the text's own length rather than starting
 * wrong and correcting — a bubble that visibly pops from capsule to rectangle
 * as the thread paints is worse than either shape. A bubble is capped at 78% of
 * the screen and padded 10 a side, so at 15pt text roughly 34 characters fit on
 * a line; `onLayout` settles anything the guess got wrong on the same frame.
 */
const ONE_LINE_MAX = 50;   // a one-line bubble is 41pt; two lines is 62
const CHARS_PER_LINE = 34;

export function useBubbleRadius(text: string | null | undefined) {
  const [multi, setMulti] = useState(() => (text?.length ?? 0) > CHARS_PER_LINE || !!text?.includes('\n'));
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const tall = e.nativeEvent.layout.height > ONE_LINE_MAX;
    setMulti((cur) => (cur === tall ? cur : tall));
  }, []);
  return { borderRadius: multi ? radius.bubble : radius.pill, onLayout };
}

/**
 * The composer's own pill, same law: a capsule until the typing wraps.
 *
 * It needs its own threshold because it is not a bubble. Measured on a 390pt
 * phone the bar is **64pt** on one line — a 38pt button with 7 of padding
 * either side, plus its border — and about 85 on two. So "one line" here is
 * anything under 74, not the bubble's 50.
 *
 * A FIXED 26 WAS THE BUG, and it is worth naming: 26 is half of the pill's
 * declared `minHeight: 52`, so it LOOKS like a capsule in the stylesheet — but
 * `minHeight` is a floor, the real box is 64, and a corner has to be half the
 * box (32) to close. The bar was therefore a rounded rectangle at every height
 * it ever had. Never derive a capsule's radius from `minHeight`; let
 * `radius.pill` clamp itself, which is what this does.
 */
const COMPOSER_ONE_LINE_MAX = 74;

export function useComposerRadius() {
  const [multi, setMulti] = useState(false);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const tall = e.nativeEvent.layout.height > COMPOSER_ONE_LINE_MAX;
    setMulti((cur) => (cur === tall ? cur : tall));
  }, []);
  return { borderRadius: multi ? radius.bubble : radius.pill, onLayout };
}
