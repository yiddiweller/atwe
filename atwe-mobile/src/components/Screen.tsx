import { View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

interface Props {
  children: React.ReactNode;
  /** Which safe-area edges to inset. Default: top + bottom. */
  edges?: Edge[];
  style?: ViewStyle;
  /** Fill with a raised surface instead of the page background. */
  raised?: boolean;
}

/**
 * Safe-area-aware page container. Handles the notch / Dynamic Island and Home
 * Indicator spacing, and paints the correct themed background so there is never
 * a white flash between screens.
 */
export function Screen({ children, edges = ['top', 'bottom'], style, raised }: Props) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: raised ? c.s1 : c.bg }}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </SafeAreaView>
  );
}
