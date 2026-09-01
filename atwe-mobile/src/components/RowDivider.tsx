import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

/**
 * The hairline under a list row — INSET to the page gutter, not edge to edge.
 *
 * The web draws it as `::after` with `left/right: var(--feed-gutter)`, which is
 * what makes a list read as rows sharing a page rather than as a table with
 * ruled lines. A `borderBottomWidth` on the row itself cannot do that: it always
 * spans the row's full width, padding included.
 *
 * Sits absolutely at the row's bottom, so it costs no height and never nudges
 * the layout — put it inside a `position:relative` row and forget about it.
 */
export function RowDivider() {
  const { c } = useTheme();
  return <View pointerEvents="none" style={[styles.line, { backgroundColor: c.border }]} />;
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
