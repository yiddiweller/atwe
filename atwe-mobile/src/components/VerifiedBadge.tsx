import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The verified seal — a neutral silver/white check (NOT blue), matching the web
 * `vbadge`. Scales with the name it sits next to.
 */
export function VerifiedBadge({ size = 15 }: { size?: number }) {
  const { c } = useTheme();
  return <Ionicons name="checkmark-circle" size={size} color={c.verify} style={{ marginLeft: 3 }} />;
}
