import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useNewsletterIssue } from '@/api/discover';
import { monthYear } from '@/lib/format';

/** Reading one issue. Long-form, so the type is generous and the measure narrow. */
export default function NewsletterIssue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, spacing: sp } = useTheme();
  const { data, isLoading, isError, refetch } = useNewsletterIssue(id);
  const i = data?.issue;

  return (
    <Screen edges={['top']}>
      <PageHeader title={i?.title ?? 'Issue'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !i ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            This issue is for subscribers, or is no longer here.
          </Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}>
          <Text variant="display" weight="800">{i.title}</Text>
          <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>{monthYear(i.createdAt)}</Text>
          <Text variant="body" tone="t2" style={styles.body}>{i.body}</Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  // Long-form: a taller line and a touch more size than a caption elsewhere.
  body: { marginTop: 20, lineHeight: 26, fontSize: 16 },
});
