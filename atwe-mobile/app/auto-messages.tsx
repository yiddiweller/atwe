import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Switch, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { saveAutoMessages } from '@/api/bizops';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';

/**
 * A greeting the first time somebody messages you, and an away reply when you
 * are not there. Free on every business account.
 *
 * The server sends the greeting ONCE per customer per fortnight and an away
 * reply at most every twelve hours — so this cannot become a machine that
 * answers every message. Worth saying on the screen, because a business will not
 * turn it on if they think it might.
 */
export default function AutoMessages() {
  const { c, radius, spacing } = useTheme();
  const { user, refresh } = useAuth();

  const [greetOn, setGreetOn] = useState(false);
  const [greet, setGreet] = useState('');
  const [awayOn, setAwayOn] = useState(false);
  const [away, setAway] = useState('');
  const [sched, setSched] = useState<'always' | 'outside_hours'>('always');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setGreetOn(!!user.greetingEnabled);
    setGreet(user.greetingMessage ?? '');
    setAwayOn(!!user.awayEnabled);
    setAway(user.awayMessage ?? '');
    setSched(user.awaySchedule === 'outside_hours' ? 'outside_hours' : 'always');
  }, [user]);

  const save = async () => {
    if (!user?.name || !user?.username) {
      Alert.alert('Auto-messages', 'Your account needs a name and a username first.');
      return;
    }
    setBusy(true);
    try {
      /* These ride on the PROFILE route, which rewrites every field it is given
         — so name and username MUST go with them or the account loses its own
         name. That has actually happened; it is not a hypothetical. */
      await saveAutoMessages({ name: user.name, username: user.username }, {
        greetingEnabled: greetOn,
        greetingMessage: greet.trim() || null,
        awayEnabled: awayOn,
        awayMessage: away.trim() || null,
        awaySchedule: sched,
      });
      await refresh();
      haptics.success();
      Alert.alert('Saved', 'Your automatic replies are up to date.');
    } catch (e) { haptics.error(); Alert.alert('Auto-messages', (e as Error).message); }
    finally { setBusy(false); }
  };

  if (user?.accountType !== 'business') {
    return (
      <Screen edges={[]}>
        <PageHeader title="Auto-messages" />
        <View style={styles.center}>
          <Text variant="body" tone="t2" style={{ textAlign: 'center' }}>
            Automatic replies are for business accounts.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PageHeader title="Auto-messages" />
      <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text variant="headline">Greeting</Text>
              <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
                The first time somebody messages you
              </Text>
            </View>
            <Switch
              value={greetOn}
              onValueChange={(v) => { haptics.select(); setGreetOn(v); }}
              trackColor={{ true: c.accent, false: c.s3 }}
              accessibilityLabel="Send a greeting"
            />
          </View>
          {greetOn && (
            <TextInput
              value={greet}
              onChangeText={setGreet}
              placeholder="Thanks for getting in touch — we usually reply within a few hours."
              placeholderTextColor={c.t4}
              multiline
              accessibilityLabel="Your greeting"
              style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
            />
          )}
        </View>

        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card, marginTop: 14 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text variant="headline">Away reply</Text>
              <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
                When you cannot get to it
              </Text>
            </View>
            <Switch
              value={awayOn}
              onValueChange={(v) => { haptics.select(); setAwayOn(v); }}
              trackColor={{ true: c.accent, false: c.s3 }}
              accessibilityLabel="Send an away reply"
            />
          </View>
          {awayOn && (
            <>
              <TextInput
                value={away}
                onChangeText={setAway}
                placeholder="We are closed right now — we will come back to you when we open."
                placeholderTextColor={c.t4}
                multiline
                accessibilityLabel="Your away reply"
                style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
              />
              <Text variant="caption" tone="t3" style={{ marginTop: 14, marginBottom: 8, letterSpacing: 0.6 }}>
                WHEN TO SEND IT
              </Text>
              {([
                ['always', 'Always', 'Whenever somebody messages'],
                ['outside_hours', 'Only when closed', 'Uses your opening hours'],
              ] as const).map(([k, label, sub]) => (
                <Pressable
                  key={k}
                  onPress={() => { haptics.select(); setSched(k); }}
                  style={[styles.opt, { borderBottomColor: c.bg }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sched === k }}
                  accessibilityLabel={label}
                >
                  <Ionicons
                    name={sched === k ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={sched === k ? c.accent : c.t4}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body">{label}</Text>
                    <Text variant="micro" tone="t3">{sub}</Text>
                  </View>
                </Pressable>
              ))}
              {sched === 'outside_hours' && (
                <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
                  With no opening hours set, it sends every time.
                </Text>
              )}
            </>
          )}
        </View>

        <Text variant="caption" tone="t3" style={{ marginTop: 16, lineHeight: 19 }}>
          A greeting goes out once per person per fortnight, and an away reply at
          most every twelve hours — never to every message.
        </Text>

        <View style={{ height: 20 }} />
        <Button title="Save" onPress={save} loading={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center' },
  input: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 78, textAlignVertical: 'top' },
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
