import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { useConnection } from '@/lib/connection';

/**
 * A slim pill that says you are offline, and a green one that says you are back.
 * It never pushes anything around and never blocks a tap — being told is useful,
 * being interrupted is not.
 */
export function OfflineBanner() {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { online, justBack } = useConnection();
  const show = !online || justBack;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: show ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [show, fade]);

  if (!show) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 6, opacity: fade }]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.pill, { backgroundColor: online ? c.success : c.s2, borderRadius: radius.pill }]}>
        <Text variant="caption" tone={online ? 'onPrimary' : 't2'} weight="600">
          {online ? 'Back online' : 'You’re offline'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 999 },
  pill: { paddingHorizontal: 14, paddingVertical: 7 },
});
