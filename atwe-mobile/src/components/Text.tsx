import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

type Variant = keyof typeof type;
type Tone = 'text' | 't2' | 't3' | 't4' | 'accent' | 'danger' | 'onPrimary';

interface Props extends TextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: TextStyle['fontWeight'];
}

/**
 * Themed text primitive. Uses the type scale + palette tokens, and allows iOS
 * Dynamic Type scaling (allowFontScaling defaults on).
 */
export function Text({ variant = 'body', tone = 'text', weight, style, ...rest }: Props) {
  const { c } = useTheme();
  const base = type[variant];
  const color = c[tone];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      style={[base, { color }, weight ? { fontWeight: weight } : null, style]}
      {...rest}
    />
  );
}
