import { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { createPost } from '@/api/social';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { radius } from '@/theme/tokens';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

const MAX = 5000;

/**
 * Composer — the create surface (blueprint §11): avatar + "What's happening?",
 * a photo, and a white Post pill. Publishes to /api/social/posts and refreshes
 * the feed. Presented as a modal sheet (see app/_layout.tsx).
 *
 * A picture with no words IS a post — half the feed is exactly that — so the
 * Post button is live as soon as there is either. And an attached photo offers
 * a description box, because a picture nobody can see is nothing at all to
 * someone using a screen reader, and the moment to write it is now rather than
 * never.
 */
export default function Compose() {
  const { c, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [alt, setAlt] = useState('');

  const canPost = (body.trim().length > 0 || !!photo) && body.length <= MAX && !busy;

  const attach = async () => {
    const r = await pickPhoto();
    if (r.ok) { setPhoto(r.dataUrl); return; }
    const m = pickPhotoMessage(r.reason);
    if (m) Alert.alert('Photo', m);
  };

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await createPost({
        body: body.trim(),
        ...(photo ? { image: photo, ...(alt.trim() ? { imageAlt: alt.trim() } : {}) } : {}),
      });
      haptics.success();
      qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const biz = user?.accountType === 'business';

  return (
    <Screen edges={['top', 'bottom']} raised>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* header */}
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text variant="headline" tone="t2">
              Cancel
            </Text>
          </Pressable>
          <Button title="Post" onPress={submit} loading={busy} disabled={!canPost} style={styles.postBtn} />
        </View>

        {/* body */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled">
          <View style={styles.row}>
            <Avatar name={user?.name} avatar={user?.avatar} biz={biz} size={40} />
            <HapticInput
              style={[styles.input, { color: c.text }]}
              placeholder="What's happening?"
              placeholderTextColor={c.t3}
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
              maxLength={MAX + 200}
              accessibilityLabel="Post text"
            />
          </View>

          {!!photo && (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
              <Pressable onPress={() => { setPhoto(null); setAlt(''); }} hitSlop={8}
                style={[styles.photoX, { backgroundColor: c.bg }]}
                accessibilityRole="button" accessibilityLabel="Remove photo">
                <Ionicons name="close" size={16} color={c.text} />
              </Pressable>
              <HapticInput
                value={alt}
                onChangeText={setAlt}
                placeholder="Describe the photo (optional)"
                placeholderTextColor={c.t3}
                maxLength={420}
                style={[styles.alt, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Photo description"
              />
            </View>
          )}

          {error && (
            <Text variant="caption" tone="danger" style={{ marginTop: 10 }}>{error}</Text>
          )}
        </ScrollView>

        {/* footer meta */}
        <View style={[styles.foot, { borderTopColor: c.border }]}>
          <Pressable onPress={attach} hitSlop={8} disabled={!!photo}
            accessibilityRole="button" accessibilityLabel="Add a photo">
            <Ionicons name="image-outline" size={23} color={photo ? c.t4 : c.accent} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text variant="caption" tone={body.length > MAX ? 'danger' : 't3'}>
            {body.length > MAX ? `${MAX - body.length}` : `${body.length}/${MAX}`}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    paddingBottom: 10,
  },
  postBtn: { minHeight: 38, paddingHorizontal: 20 },
  row: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, fontSize: 17, lineHeight: 23, paddingTop: 8, minHeight: 110, textAlignVertical: 'top' },
  photoWrap: { marginTop: 12, marginLeft: 50 },
  photo: { width: '100%', aspectRatio: 1.4, borderRadius: radius.lg },
  photoX: {
    position: 'absolute', top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  alt: {
    marginTop: 8, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
  },
});
