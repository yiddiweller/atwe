import { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';
import { createPost } from '@/api/social';

const MAX = 5000;

/**
 * Composer — the create surface (blueprint §11): avatar + "What's happening?",
 * a white Post pill. Publishes to /api/social/posts and refreshes the feed.
 * Presented as a modal sheet (see app/_layout.tsx).
 */
export default function Compose() {
  const { c, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = body.trim().length > 0 && body.length <= MAX && !busy;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await createPost({ body: body.trim() });
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
        <View style={[styles.row, { paddingHorizontal: spacing.lg }]}>
          <Avatar name={user?.name} avatar={user?.avatar} biz={biz} size={40} />
          <TextInput
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

        {error && (
          <Text variant="caption" tone="danger" style={{ paddingHorizontal: spacing.lg }}>
            {error}
          </Text>
        )}

        {/* footer meta */}
        <View style={[styles.foot, { borderTopColor: c.border }]}>
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
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  postBtn: { minHeight: 38, paddingHorizontal: 20 },
  row: { flexDirection: 'row', gap: 10, flex: 1 },
  input: { flex: 1, fontSize: 17, lineHeight: 23, paddingTop: 8, textAlignVertical: 'top' },
  foot: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'flex-end',
  },
});
