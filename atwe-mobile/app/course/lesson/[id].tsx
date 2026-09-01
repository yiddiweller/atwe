import { useState } from 'react';
import { View, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useCourse, completeLesson } from '@/api/discover';
import { haptics } from '@/lib/haptics';

/**
 * One lesson. Read from the course detail rather than its own endpoint, because
 * that read already carries the unlocked body and video for anybody entitled to
 * them — a second request would only re-ask the same gate.
 */
export default function LessonView() {
  const { id, course } = useLocalSearchParams<{ id: string; course: string }>();
  const { c, spacing: sp } = useTheme();
  const { data, isLoading, refetch } = useCourse(course);
  const lessons = data?.course?.lessons ?? [];
  const i = lessons.findIndex((l) => String(l.id) === String(id));
  const lesson = i >= 0 ? lessons[i] : undefined;
  const [busy, setBusy] = useState(false);

  const player = useVideoPlayer(lesson?.videoUrl ?? '', (p) => { p.loop = false; });

  const mark = async () => {
    if (!lesson) return;
    setBusy(true);
    try {
      await completeLesson(Number(course), lesson.id, !lesson.done);
      haptics.success();
      await refetch();
    } catch (e) { haptics.error(); Alert.alert('Lesson', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title={lesson?.title ?? 'Lesson'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : !lesson || lesson.locked ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">You need to enrol to open this lesson.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}>
          {!!lesson.videoUrl && (
            <VideoView
              player={player}
              style={[styles.video, { backgroundColor: c.s2 }]}
              nativeControls
              allowsFullscreen
            />
          )}
          <Text variant="title" weight="800" style={{ marginTop: lesson.videoUrl ? 16 : 0 }}>
            {lesson.title}
          </Text>
          {!!lesson.section && (
            <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>{lesson.section}</Text>
          )}
          {!!lesson.content && (
            <Text variant="body" tone="t2" style={styles.body}>{lesson.content}</Text>
          )}
          <View style={{ marginTop: 26 }}>
            <Button
              title={lesson.done ? 'Done ✓' : 'Mark as done'}
              kind={lesson.done ? 'secondary' : 'primary'}
              loading={busy}
              onPress={mark}
            />
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, overflow: 'hidden' },
  body: { marginTop: 16, lineHeight: 25, fontSize: 16 },
});
