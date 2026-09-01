import { useRef } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { haptics } from '@/lib/haptics';

/**
 * Six boxes for the emailed code, mirroring the web's `.otp-row`.
 *
 * ONE hidden input does the typing and the boxes are just painted from its
 * value. Six real inputs with focus hopping between them is the usual approach
 * and it is a bad one: paste puts the whole code in box 1, backspace at an
 * empty box has to guess where to go, and iOS's one-time-code autofill only
 * ever fills the field it is on.
 */
export function OtpBoxes({ value, onChange, state = 'idle', length = 6 }: {
  value: string;
  onChange: (v: string) => void;
  /** `ok` after the server accepts it, `bad` after it refuses. */
  state?: 'idle' | 'ok' | 'bad';
  length?: number;
}) {
  const input = useRef<TextInput>(null);
  const chars = value.split('');

  /* `.otp-box` verbatim. The sign-in gate is black in every theme, so these
     are literals here for the same reason the web's are. */
  const border =
    state === 'ok' ? 'rgba(48,209,88,0.95)'
    : state === 'bad' ? 'rgba(255,0,51,0.95)'
    : 'rgba(255,255,255,0.14)';
  const fill =
    state === 'ok' ? 'rgba(48,209,88,0.12)'
    : state === 'bad' ? 'rgba(255,0,51,0.14)'
    : 'rgba(255,255,255,0.05)';

  return (
    <Pressable
      onPress={() => { haptics.tap(); input.current?.focus(); }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel="Enter the code you were emailed"
    >
      {Array.from({ length }).map((_, i) => {
        const filled = i < chars.length;
        /* The caret is where the NEXT character goes, so the box that is
           "current" is the first empty one — not the last filled one. */
        const here = i === chars.length && chars.length < length;
        return (
          <View
            key={i}
            style={[styles.box, {
              backgroundColor: here && state === 'idle' ? 'rgba(255,255,255,0.09)' : fill,
              /* `.otp-box:focus` — the box the next digit lands in is the one
                 that lights, which is the only caret these boxes have. */
              borderColor: here && state === 'idle' ? 'rgba(255,255,255,0.6)' : border,
            }]}
          >
            <Text style={styles.digit}>{filled ? chars[i] : ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus
        /* Off-screen rather than `opacity:0` — a zero-opacity input can still be
           tapped, which puts a caret on the real field and shows a second
           keyboard-selection UI over the boxes. */
        style={styles.hidden}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 20 },
  box: {
    flex: 1, minWidth: 0, aspectRatio: 1, minHeight: 54,
    borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  digit: { fontSize: 26, fontWeight: '600', color: '#fff' },
  hidden: { position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 },
});
