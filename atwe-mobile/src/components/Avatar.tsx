import { View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { mediaUri } from '@/lib/media';

/**
 * Account avatar. Falls back to the first initial on a flat tint (Atwe's single
 * default-avatar tone). Business accounts render as an app-shaped rounded square
 * (the one visual tell for a business), matching the web `acAvatarHtml`.
 */
export function Avatar({
  name,
  avatar,
  biz,
  size = 44,
}: {
  name?: string | null;
  avatar?: string | null;
  biz?: boolean;
  size?: number;
}) {
  const { c } = useTheme();
  /* EVERY avatar is a full circle, business or person. Business accounts used
     to be an app-shaped rounded square (28%) — that was the web's rule and the
     phone copied it faithfully, but the web dropped it: `.user-avatar.biz` is
     `border-radius:50%` now, at the founder's decision, with a new business
     tell coming separately. `biz` stays on the prop because the shape is not
     the only thing it will ever drive. */
  const r = size / 2;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: c.s2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {avatar ? (
        <Image
          source={{ uri: mediaUri(avatar) }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <Text style={{ fontSize: size * 0.4, fontWeight: '700', color: c.t2 }}>{initial}</Text>
      )}
    </View>
  );
}
