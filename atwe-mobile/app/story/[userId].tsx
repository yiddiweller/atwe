import { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { GlassIcon } from '@/components/Glass';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { useUserStories, markStorySeen, type Story } from '@/api/stories';
import { mediaUri } from '@/lib/media';
import { storyGradient } from '@/lib/storyBg';

const STORY_DUR = 5000; // ms per story, matching the web STORY_DUR

/* The `bg` on a story is usually a PRESET ID ('g1'…'g6'), not a hex — that is
   what the web writes. Trusting only a hex painted every text story posted from
   a browser plain black; storyGradient() resolves both. */

/**
 * Full-screen story viewer — mirrors the web `acStoryShow`: segmented progress
 * bars up top, auto-advance, tap-right/left to skip, marks each story seen.
 * Image, text and video all render natively (expo-video for the last).
 */
export default function StoryViewer() {
  const { c } = useTheme();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const uid = Number(userId);
  const { data, isLoading, isError } = useUserStories(Number.isFinite(uid) ? uid : undefined);
  const stories = data?.stories ?? [];

  const [index, setIndex] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  const close = () => router.back();
  const current = stories[index];

  // Drive auto-advance + progress whenever the active story changes.
  useEffect(() => {
    if (!current) return;
    markStorySeen(current.id);
    progress.setValue(0);
    anim.current?.stop();
    anim.current = Animated.timing(progress, {
      toValue: 1,
      duration: STORY_DUR,
      useNativeDriver: false,
    });
    anim.current.start(({ finished }) => {
      if (finished) next();
    });
    return () => anim.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.id]);

  const next = () => {
    if (index < stories.length - 1) setIndex((i) => i + 1);
    else close();
  };
  const prev = () => {
    if (index > 0) setIndex((i) => i - 1);
    else progress.setValue(0);
  };

  if (isLoading) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: '#000' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (isError || !current) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: '#000' }]}>
        <StatusBar style="light" />
        <Text variant="body" style={{ color: '#fff' }}>
          No active story.
        </Text>
        <Pressable onPress={close} hitSlop={12} style={{ marginTop: 16 }}>
          <Text variant="headline" style={{ color: '#fff' }}>
            Close
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={storyGradient(current.bg)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fill}
    >
      <StatusBar style="light" />

      {/* Media */}
      <StoryMedia story={current} />

      {/* Tap zones: left third = back, right = forward */}
      <View style={styles.zones} pointerEvents="box-none">
        <Pressable style={styles.zoneLeft} onPress={prev} />
        <Pressable style={styles.zoneRight} onPress={next} />
      </View>

      {/* Top chrome: progress bars + close */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.bars}>
          {stories.map((s, i) => (
            <View key={s.id} style={styles.barTrack}>
              <Animated.View
                style={[
                  styles.barFill,
                  {
                    width:
                      i < index
                        ? '100%'
                        : i === index
                          ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                          : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>
        {/* Real glass, over a photograph — the disc Apple floats on a full-bleed
            viewer. Its glyph is forced white rather than themed: the material is
            sampling whatever the story happens to be, so a theme colour could
            land on anything. */}
        <View style={styles.close}>
          <GlassIcon onPress={close} label="Close" size={38} overContent>
            <Ionicons name="close" size={22} color="#fff" />
          </GlassIcon>
        </View>
      </SafeAreaView>

      {/* Caption */}
      {current.kind !== 'text' && !!current.caption && (
        <SafeAreaView edges={['bottom']} style={styles.captionWrap} pointerEvents="none">
          <Text variant="body" style={styles.caption}>
            {current.caption}
          </Text>
        </SafeAreaView>
      )}
    </LinearGradient>
  );
}

function StoryMedia({ story }: { story: Story }) {
  if (story.kind === 'image' && story.media) {
    return <Image source={{ uri: mediaUri(story.media) }} style={styles.fill} contentFit="contain" />;
  }
  if (story.kind === 'text') {
    return (
      <View style={[styles.fill, styles.center, { paddingHorizontal: 32 }]}>
        <Text variant="title" style={styles.textStory}>
          {story.caption || ''}
        </Text>
      </View>
    );
  }
  if (story.kind === 'video' && story.media) return <StoryVideo uri={mediaUri(story.media)!} />;
  // Nothing to show — a story whose media has gone.
  return (
    <View style={[styles.fill, styles.center]}>
      <Ionicons name="image-outline" size={54} color="rgba(255,255,255,0.7)" />
      <Text variant="callout" style={{ color: 'rgba(255,255,255,0.7)', marginTop: 10 }}>
        This one is no longer available
      </Text>
    </View>
  );
}

/**
 * A video story, played properly. It is tapped to open, so sound is allowed —
 * autoplay-with-sound rules are about video that starts on its own, which this
 * is not. It loops rather than freezing on a black last frame, because a story
 * advances on a timer and a frozen frame reads as broken.
 */
function StoryVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      style={styles.fill}
      player={player}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  center: { alignItems: 'center', justifyContent: 'center' },
  zones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  zoneLeft: { width: '32%', height: '100%' },
  zoneRight: { flex: 1, height: '100%' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10 },
  bars: { flexDirection: 'row', gap: 4, marginTop: 6 },
  barTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  close: { alignSelf: 'flex-end', marginTop: 10, marginRight: 12 },
  textStory: { color: '#fff', fontSize: 26, lineHeight: 34, textAlign: 'center', fontWeight: '700' },
  captionWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
  caption: {
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
});
