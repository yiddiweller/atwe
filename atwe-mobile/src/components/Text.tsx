import { createContext, useContext } from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

type Variant = keyof typeof type;
type Tone = 'text' | 't2' | 't3' | 't4' | 'accent' | 'danger' | 'warning' | 'success' | 'onPrimary';

interface Props extends TextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: TextStyle['fontWeight'];
}

/**
 * Am I inside another <Text>? React Native inherits text style down a nesting,
 * and this is what lets that actually happen — see below.
 */
const Nested = createContext(false);

/**
 * Themed text primitive. Uses the type scale + palette tokens, and allows iOS
 * Dynamic Type scaling (allowFontScaling defaults on).
 *
 * A NESTED <Text> INHERITS, and getting that wrong is visible from across the
 * room. This used to default `variant` to `body` unconditionally, so every
 * nested span — the "Terms" and "Privacy Policy" links inside the sign-in
 * screen's 10.5px small print, a bold word inside a sentence, a coloured name
 * inside a notification line — was stamped with body's 15px/21 and blew out of
 * the line it was sitting in. The founder photographed exactly that: the first
 * half of the terms line small and the links beside it half again as large.
 *
 * So: a Text inside another Text takes NO base style unless it explicitly asks
 * for a variant. Colour and weight still apply, which is all a span like that
 * ever wanted. It is the same rule CSS has, and it fixes every nesting in the
 * app at once rather than one at a time.
 */
export function Text({ variant, tone = 'text', weight, style, ...rest }: Props) {
  const { c } = useTheme();
  const nested = useContext(Nested);
  /* Only a span that says nothing about its size inherits. Ask for a variant
     and you get it, nested or not. */
  const base = variant ? type[variant] : nested ? null : type.body;
  /* A nested span with no tone of its own inherits the colour too — stamping
     the default `text` on it would override the parent for no reason. */
  const color = tone === 'text' && nested ? null : { color: c[tone] };
  return (
    <Nested.Provider value>
      <RNText
        maxFontSizeMultiplier={1.6}
        style={[base, color, weight ? { fontWeight: weight } : null, style]}
        {...rest}
      />
    </Nested.Provider>
  );
}
