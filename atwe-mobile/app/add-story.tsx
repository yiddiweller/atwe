import { useState } from 'react';
import {
  View, TextInput, Pressable, KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromePill } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { postStory, type StoryAudience } from '@/api/stories';
import { STORY_BGS, storyGradient } from '@/lib/storyBg';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * Add to your story.
 *
 * You could watch everyone else's and never post one — the tray had no way in.
 * Two kinds, which is what the phone can honestly do: a photo, or words on one
 * of the six colours the web uses (the same preset ids, so a story posted here
 * looks the same in a browser). Video stories exist server-side and are left
 * for later rather than half-done.
 *
 * It says out loud that it disappears after a day, because that is the thing
 * people most want to be sure of before posting one.
 */
export default function AddStory() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [bg, setBg] = useState(STORY_BGS[0].id);
  const [audience, setAudience] = useState<StoryAudience>('all');
  const [busy, setBusy] = useState(false);

  const kind: 'image' | 'text' = photo ? 'image' : 'text';
  const canPost = (!!photo || caption.trim().length > 0) && !busy;

  const attach = async () => {
    const r = await pickPhoto();
    if (r.ok) { setPhoto(r.dataUrl); return; }
    const m = pickPhotoMessage(r.reason);
    if (m) Alert.alert('Photo', m);
  };

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    try {
      await postStory({
        kind,
        ...(photo ? { media: photo } : {}),
        caption: caption.trim(),
        ...(kind === 'text' ? { bg } : {}),
        audience,
      });
      haptics.success();
      qc.invalidateQueries({ queryKey: ['storyTray'] });
      qc.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    } catch (e) {
      haptics.error(); Alert.alert('Story', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} raised>
      <KeyboardAvoidingView style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The same pair as the composer — see Apple's Voicemail. */}
        <View style={styles.head}>
          <ChromePill text="Cancel" onPress={() => router.back()} />
          <Text variant="headline">Your story</Text>
          <View style={{ width: 84 }} />
        </View>

        {/* What it will look like */}
        <View style={styles.previewWrap}>
          {photo ? (
            <View style={styles.preview}>
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <Pressable onPress={() => setPhoto(null)} hitSlop={8}
                style={[styles.x, { backgroundColor: c.bg }]}
                accessibilityRole="button" accessibilityLabel="Remove photo">
                <Ionicons name="close" size={16} color={c.text} />
              </Pressable>
              {!!caption.trim() && (
                <View style={styles.capWrap}>
                  <Text variant="body" style={styles.capText} numberOfLines={3}>{caption}</Text>
                </View>
              )}
            </View>
          ) : (
            <LinearGradient
              colors={storyGradient(bg)}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.preview}
            >
              <Text variant="title" style={styles.bigText} numberOfLines={6}>
                {caption.trim() || 'Say something'}
              </Text>
            </LinearGradient>
          )}
        </View>

        <View style={styles.controls}>
          <HapticInput
            value={caption}
            onChangeText={setCaption}
            placeholder={photo ? 'Add a caption (optional)' : 'What do you want to say?'}
            placeholderTextColor={c.t3}
            multiline
            maxLength={300}
            style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
            accessibilityLabel="Story text"
          />

          {!photo && (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>Colour</Text>
              <View style={styles.swatches}>
                {STORY_BGS.map((b) => (
                  <Pressable key={b.id} onPress={() => { haptics.select(); setBg(b.id); }}
                    accessibilityRole="radio" accessibilityState={{ selected: bg === b.id }}
                    accessibilityLabel={`Background ${b.id}`}>
                    <LinearGradient
                      colors={b.colors}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={[styles.swatch, bg === b.id && { borderColor: c.text, borderWidth: 2 }]}
                    />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text variant="caption" tone="t3" style={styles.lbl}>Who sees it</Text>
          <View style={styles.chips}>
            {(['all', 'close'] as StoryAudience[]).map((a) => (
              <Pressable key={a} onPress={() => { haptics.select(); setAudience(a); }}
                style={[styles.chip, { backgroundColor: audience === a ? c.accent : c.s1 }]}
                accessibilityRole="radio" accessibilityState={{ selected: audience === a }}>
                <Text variant="callout" weight="600"
                  style={{ color: audience === a ? c.accentTint : c.text }}>
                  {a === 'all' ? 'Everyone following you' : 'Close friends'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={attach} disabled={!!photo} style={styles.photoRow}
            accessibilityRole="button" accessibilityLabel="Use a photo instead">
            <Ionicons name="image-outline" size={20} color={photo ? c.t4 : c.accent} />
            <Text variant="callout" style={{ color: photo ? c.t4 : c.accent, marginLeft: 8 }}>
              {photo ? 'Photo added' : 'Use a photo instead'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.foot, { borderTopColor: c.border }]}>
          <Text variant="caption" tone="t3" style={{ textAlign: 'center', marginBottom: 10 }}>
            It disappears after 24 hours.
          </Text>
          <Button title="Add to your story" kind="primary"
            loading={busy} disabled={!canPost} onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter, paddingBottom: 10,
  },
  previewWrap: { alignItems: 'center', paddingHorizontal: spacing.gutter },
  preview: {
    width: 148, aspectRatio: 0.62, borderRadius: radius.lg, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', padding: 12,
  },
  bigText: { color: '#fff', textAlign: 'center' },
  capWrap: { position: 'absolute', left: 8, right: 8, bottom: 10 },
  capText: { color: '#fff', textAlign: 'center' },
  x: {
    position: 'absolute', top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  controls: { paddingHorizontal: spacing.gutter, paddingTop: 16, flex: 1 },
  input: {
    borderRadius: radius.bubble, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 16, minHeight: 74, textAlignVertical: 'top',
  },
  lbl: { marginTop: 14, marginBottom: 7 },
  swatches: { flexDirection: 'row', gap: 10 },
  swatch: { width: 38, height: 38, borderRadius: 19, borderColor: 'transparent', borderWidth: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  foot: {
    padding: spacing.gutter, paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
