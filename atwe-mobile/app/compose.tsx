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
import { GlassIcon } from '@/components/Glass';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromePill } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { createPost, usePost } from '@/api/social';
import { QuotedPostCard } from '@/components/QuotedPostCard';
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
  /* `?quote=<id>` turns the composer into a quote post — the same screen, with
     the post being quoted shown underneath so you can see what you are
     answering while you write it. */
  const { quote: quoteParam } = useLocalSearchParams<{ quote?: string }>();
  const quoteId = Number(quoteParam);
  const quoting = Number.isFinite(quoteId) && quoteId > 0;
  const quoted = usePost(quoting ? quoteId : '');
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [poll, setPoll] = useState<string[] | null>(null);
  const [pollDays, setPollDays] = useState(7);

  const pollReady = !!poll && poll.filter((o) => o.trim()).length >= 2;
  /* A poll or a quote IS content, so either can carry a post on its own — the
     server agrees, and requiring text as well would just be the phone being
     stricter than the thing it talks to. */
  const canPost = (body.trim().length > 0 || !!photo || pollReady || quoting)
    && body.length <= MAX && !busy;

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
        ...(pollReady ? { poll: poll!.map((o) => o.trim()).filter(Boolean), pollDays } : {}),
        ...(quoting ? { quoteId } : {}),
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
        {/* Apple's own pair, from Voicemail and Photos: a quiet glass capsule
            beside the one lighter, prominent one the screen is actually for. */}
        <View style={styles.head}>
          <ChromePill text="Cancel" onPress={() => router.back()} />
          <ChromePill text={busy ? 'Posting…' : 'Post'} prominent disabled={!canPost || busy} onPress={submit} />
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
              {/* A control sitting ON a photograph — glass, never a painted
                  black dot, because the material is what lets the picture
                  read through it. */}
              <GlassIcon onPress={() => { setPhoto(null); setAlt(''); }}
                label="Remove photo" size={28} style={styles.photoX}>
                <Ionicons name="close" size={16} color={c.text} />
              </GlassIcon>
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

          {!!poll && (
            <View style={{ marginTop: 14 }}>
              {poll.map((o, i) => (
                <View key={i} style={styles.pollRow}>
                  <HapticInput
                    value={o}
                    onChangeText={(t) => setPoll((s2) => s2!.map((x, j) => (j === i ? t : x)))}
                    placeholder={`Option ${i + 1}`}
                    placeholderTextColor={c.t3}
                    maxLength={30}
                    style={[styles.pollInput, { backgroundColor: c.s1, color: c.text }]}
                    accessibilityLabel={`Poll option ${i + 1}`}
                  />
                  {/* Two is the minimum the server takes, so the last two rows
                      cannot be removed — offering it would just produce a poll
                      that silently does not become one. */}
                  {poll.length > 2 && (
                    <Pressable onPress={() => setPoll((s2) => s2!.filter((_, j) => j !== i))}
                      hitSlop={8} style={{ marginLeft: 8 }}
                      accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`}>
                      <Ionicons name="close-circle" size={20} color={c.t3} />
                    </Pressable>
                  )}
                </View>
              ))}
              <View style={styles.pollFoot}>
                {poll.length < 4 && (
                  <Pressable onPress={() => setPoll((s2) => [...s2!, ''])} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel="Add another option">
                    <Text variant="caption" tone="accent">Add an option</Text>
                  </Pressable>
                )}
                <View style={{ flex: 1 }} />
                {[1, 3, 7, 14].map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => { haptics.select(); setPollDays(d); }}
                    style={[styles.days, { backgroundColor: pollDays === d ? c.accent : c.s1 }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: pollDays === d }}
                    accessibilityLabel={`${d} ${d === 1 ? 'day' : 'days'}`}
                  >
                    <Text variant="micro" style={{ color: pollDays === d ? '#fff' : c.t3 }}>{d}d</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setPoll(null)} hitSlop={8} style={{ marginLeft: 10 }}
                  accessibilityRole="button" accessibilityLabel="Remove the poll">
                  <Ionicons name="trash-outline" size={17} color={c.t3} />
                </Pressable>
              </View>
            </View>
          )}

          {quoting && quoted.data?.post && <QuotedPostCard quote={{
            id: quoted.data.post.id,
            body: quoted.data.post.body,
            image: quoted.data.post.image,
            media: null,
            mediaKind: null,
            created_at: quoted.data.post.created_at,
            author: quoted.data.post.author,
          }} />}

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
          {/* No poll on a quote: the server takes a poll only on a top-level
              post, and a quote is one of those — but a card that is both is a
              card nobody can read. */}
          {!quoting && (
            <Pressable
              onPress={() => { haptics.tap(); setPoll((p2) => (p2 ? null : ['', ''])); }}
              hitSlop={8}
              style={{ marginLeft: 18 }}
              accessibilityRole="button"
              accessibilityLabel={poll ? 'Remove the poll' : 'Add a poll'}
            >
              <Ionicons name="stats-chart-outline" size={22} color={poll ? c.accent : c.accent} />
            </Pressable>
          )}
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
  row: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, fontSize: 17, lineHeight: 23, paddingTop: 8, minHeight: 110, textAlignVertical: 'top' },
  pollRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  pollInput: { flex: 1, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  pollFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  days: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  photoWrap: { marginTop: 12, marginLeft: 50 },
  photo: { width: '100%', aspectRatio: 1.4, borderRadius: radius.lg },
  photoX: { position: 'absolute', top: 8, right: 8 },
  alt: {
    marginTop: 8, borderRadius: radius.pill,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 14,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
  },
});
