import { useState } from 'react';
import { View, Modal, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/lib/haptics';
import {
  notInterested, muteUser, blockUser, reportThing, deletePost, pinPost,
  REPORT_REASONS, type ReportReason,
} from '@/api/social';
import type { Post } from '@/api/social';

/**
 * The ⋯ on a post — how somebody gets a post out of their feed, and how they
 * report one. Without it there was no way to do either from the phone, which is
 * a safety hole, not a missing convenience.
 *
 * It is a real bottom sheet rather than an Alert action-sheet because Report
 * needs a second page (which reason), and stacking two system alerts reads as
 * an error rather than as a menu.
 */
export function PostMenu({ post, mine, visible, onClose, onGone }: {
  post: Post;
  /** True when the signed-in account wrote it. */
  mine: boolean;
  visible: boolean;
  onClose: () => void;
  /** The post should leave the list — hidden, deleted or its author blocked. */
  onGone?: () => void;
}) {
  const { c, radius } = useTheme();
  const [page, setPage] = useState<'menu' | 'report'>('menu');
  const [busy, setBusy] = useState(false);
  const author = post.author;

  const close = () => { setPage('menu'); onClose(); };

  /** Every action is the same shape: do it, say so, get out of the way. */
  const run = async (fn: () => Promise<void>, done: string, removes: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      haptics.success();
      close();
      if (removes) onGone?.();
      Alert.alert('Done', done);
    } catch (e) {
      haptics.error();
      Alert.alert('Sorry', (e as Error).message);
    } finally { setBusy(false); }
  };

  const confirmThen = (title: string, msg: string, verb: string, fn: () => void) => {
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: 'destructive', onPress: fn },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: c.s1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }]}>
        <View style={[styles.grab, { backgroundColor: c.t4 }]} />
        {page === 'menu' ? (
          <ScrollView bounces={false}>
            {mine ? (
              <>
                {/* Pin only, never Unpin: `mapPost` carries no pinned flag, so a
                    feed card genuinely does not know. Saying "Unpin" on a guess
                    would be worse than not offering it — and an account pins ONE
                    post, so pinning another replaces it anyway. */}
                <Row
                  icon="pin-outline"
                  label="Pin to your profile"
                  sub="It sits at the top, above your other posts"
                  onPress={() => run(() => pinPost(post.id, true), 'Pinned to your profile.', false)}
                />
                <Row
                  icon="trash-outline"
                  label="Delete this post"
                  danger
                  onPress={() => confirmThen('Delete this post?', 'It cannot be undone.', 'Delete',
                    () => run(() => deletePost(post.id), 'The post is gone.', true))}
                />
              </>
            ) : (
              <>
                <Row
                  icon="eye-off-outline"
                  label="Not interested in this"
                  sub="Hides it, and shows you fewer like it"
                  onPress={() => run(() => notInterested(post.id), 'You will see fewer posts like that.', true)}
                />
                {!!author?.id && (
                  <Row
                    icon="volume-mute-outline"
                    label={`Mute ${author.username ? '@' + author.username : author.name}`}
                    sub="Their posts leave your feed. They are never told."
                    onPress={() => run(() => muteUser(author.id, true), 'Muted.', true)}
                  />
                )}
                <Row
                  icon="flag-outline"
                  label="Report this post"
                  onPress={() => { haptics.tap(); setPage('report'); }}
                />
                {!!author?.id && (
                  <Row
                    icon="ban-outline"
                    label={`Block ${author.username ? '@' + author.username : author.name}`}
                    sub="Cuts contact both ways, everywhere"
                    danger
                    onPress={() => confirmThen(
                      'Block this account?',
                      'Neither of you will be able to see or message the other.',
                      'Block',
                      () => run(() => blockUser(author.id, true), 'Blocked.', true))}
                  />
                )}
              </>
            )}
            <Row icon="close-outline" label="Cancel" onPress={close} />
          </ScrollView>
        ) : (
          <ScrollView bounces={false}>
            <Text variant="caption" tone="t3" style={styles.head}>WHAT IS WRONG WITH IT?</Text>
            {REPORT_REASONS.map((r) => (
              <Row
                key={r.key}
                icon="chevron-forward-outline"
                label={r.label}
                onPress={() => run(
                  () => reportThing('post', post.id, r.key as ReportReason),
                  'Thank you. Our team will look at it.',
                  true,
                )}
              />
            ))}
            <Row icon="arrow-back-outline" label="Back" onPress={() => { haptics.tap(); setPage('menu'); }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Row({ icon, label, sub, danger, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s2 }]}
    >
      <Ionicons name={icon} size={20} color={danger ? c.danger : c.t2} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text variant="body" style={danger ? { color: c.danger } : undefined}>{label}</Text>
        {!!sub && <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>{sub}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '76%', paddingBottom: 34, paddingTop: 8,
  },
  grab: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, opacity: 0.6, marginBottom: 8 },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, minHeight: 55 },
});
