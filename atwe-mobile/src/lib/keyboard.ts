import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How tall the keyboard is right now, in points. 0 when it is down.
 *
 * This is the web's `--kb` custom property, ported: `.auth-step` pads its bottom
 * by `max(28px + safe-area, var(--kb) + 16px)`, so the Continue button pinned at
 * the bottom of the step always sits just above the keyboard.
 *
 * It replaces `KeyboardAvoidingView`, which was leaving the button half-covered
 * on the signup steps — the founder photographed it on the @username step. KAV
 * works out its own lift by measuring its frame against the keyboard's, and
 * inside a safe-area view that already claims the bottom inset the two
 * measurements disagree. Reading the keyboard's height directly and padding by
 * it has no measurement to get wrong.
 *
 * `WillShow` rather than `DidShow` on iOS: the padding then changes in the same
 * frame the keyboard starts moving, so the button rides up with it instead of
 * jumping once it has arrived.
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(show, (e) => setH(e.endCoordinates?.height ?? 0));
    const b = Keyboard.addListener(hide, () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}
