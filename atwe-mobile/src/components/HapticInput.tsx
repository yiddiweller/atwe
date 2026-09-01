import { forwardRef, useRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { haptics } from '@/lib/haptics';

/**
 * A TextInput that feels like one.
 *
 * Two moments get a tick, and only two:
 *
 *   THE CARET LANDING — you have arrived somewhere you can type.
 *   A CHARACTER COMING BACK OUT — deleting is undoing, and undoing should be
 *   felt.
 *
 * Typing FORWARD is deliberately silent. iOS gives the keyboard its own
 * feedback, and adding a second generator per keystroke is precisely the muddy
 * buzz the haptics module exists to prevent — at speed the Taptic Engine cannot
 * separate them and the whole field hums. The throttle would catch it, but the
 * right answer is not to ask.
 *
 * A drop-in replacement: same props, same ref. Swap the import and a field
 * behaves; there is nothing to remember at the call site.
 */
export const HapticInput = forwardRef<TextInput, TextInputProps>(function HapticInput(
  { onChangeText, onFocus, ...rest }, ref,
) {
  // The last value we SAW, not the last one rendered — a controlled field can
  // re-render between keystrokes and props.value is not a reliable "before".
  const seen = useRef(String(rest.value ?? ''));

  return (
    <TextInput
      ref={ref}
      {...rest}
      onFocus={(e) => {
        seen.current = String(rest.value ?? '');
        haptics.select();
        onFocus?.(e);
      }}
      onChangeText={(t) => {
        if (t.length < seen.current.length) haptics.select();
        seen.current = t;
        onChangeText?.(t);
      }}
    />
  );
});
