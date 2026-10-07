import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';

/** A 0–5 rating, drawn. Amber is the app's information colour, which is what a
 *  rating is — not a success and not a warning. */
export function Stars({ n, size = 14 }: { n: number; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= n ? 'star' : 'star-outline'} size={size}
          color={i <= n ? c.warning : c.t4} />
      ))}
    </View>
  );
}
