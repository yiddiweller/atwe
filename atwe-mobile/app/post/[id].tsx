import { useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { PostCard } from '@/components/PostCard';
import { useTheme } from '@/theme/ThemeProvider';
import { usePost, createPost } from '@/api/social';

/**
 * Post detail — the reading surface: the post in full, then its replies as
 * standard cards, with a docked reply bar (shown only when the viewer may
 * reply; the create route enforces it authoritatively).
 */
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = usePost(id);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const post = data?.post;
  const replies = data?.replies ?? [];
  const canReply = post?.canReply !== false; // undefined → allow, backend re-checks

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await createPost({ body, parentId: Number(id) });
      setReply('');
      await refetch();
      qc.invalidateQueries({ queryKey: ['feed'] });
    } catch {
      // keep the text so the user can retry
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      {/* header */}
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <Text variant="headline">Post</Text>
        <View style={styles.back} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError || !post ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            Couldn't load this post.
          </Text>
          <Pressable onPress={() => refetch()} style={{ marginTop: 12 }}>
            <Text variant="headline" tone="accent">
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <FlatList
            data={replies}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item }) => <PostCard post={item} />}
            ListHeaderComponent={
              <View>
                <PostCard post={post} linkToDetail={false} />
                {replies.length > 0 && (
                  <Text variant="callout" tone="t3" style={styles.repliesLabel}>
                    Replies
                  </Text>
                )}
              </View>
            }
            ListEmptyComponent={
              <Text variant="caption" tone="t3" style={styles.noReplies}>
                No replies yet.
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />

          {canReply && (
            <View style={[styles.replyBar, { borderTopColor: c.border, backgroundColor: c.bg }]}>
              <TextInput
                style={[styles.input, { backgroundColor: c.s2, color: c.text }]}
                placeholder="Post your reply"
                placeholderTextColor={c.t3}
                value={reply}
                onChangeText={setReply}
                multiline
                accessibilityLabel="Write a reply"
              />
              <Pressable
                onPress={send}
                disabled={!reply.trim() || sending}
                style={[
                  styles.send,
                  { backgroundColor: c.primary, opacity: !reply.trim() || sending ? 0.4 : 1 },
                ]}
                hitSlop={6}
              >
                {sending ? (
                  <ActivityIndicator color={c.onPrimary} size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={c.onPrimary} />
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, height: 28, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  repliesLabel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  noReplies: { textAlign: 'center', paddingVertical: 28 },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
