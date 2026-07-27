import { useState } from 'react';
import { View, TextInput, KeyboardAvoidingView, Platform, StyleSheet, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Making an account, in the same page-by-page shape as the web wizard: what
 * kind of account first, then who you are, then how to get back in.
 *
 * Asking the account type FIRST is deliberate — it changes what "your name"
 * means (a person, or a business) and the wording follows from it, rather than
 * somebody filling in a personal form and being told afterwards it was wrong.
 */
type Step = 'kind' | 'you' | 'access';

export default function Signup() {
  const { c, spacing, radius } = useTheme();
  const { signup } = useAuth();

  const [step, setStep] = useState<Step>('kind');
  const [accountType, setAccountType] = useState<'personal' | 'business'>('personal');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input = {
    backgroundColor: c.s2,
    color: c.text,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 16,
  } as const;

  const isBiz = accountType === 'business';
  // A handle is what other people type to find you, so the rules are checked
  // here rather than only being reported by the server after a round trip.
  const handleOk = /^[a-z0-9_]{3,24}$/.test(username);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const passOk = password.length >= 8;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signup({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        password,
        accountType,
      });
      // The root guard sends us into the app the moment there is a user.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const card = (active: boolean) => ({
    backgroundColor: c.s1,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 2,
    borderColor: active ? c.accent : 'transparent',
  });

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingHorizontal: spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="display" style={{ letterSpacing: 0.5 }}>
            Atwe<Text variant="display" tone="accent">.</Text>
          </Text>

          {step === 'kind' && (
            <>
              <Text variant="title" style={{ marginTop: 24 }}>What kind of account?</Text>
              <Text variant="body" tone="t2" style={{ marginTop: 6, marginBottom: 20 }}>
                You can change this later, but it decides how people find you.
              </Text>
              <Pressable
                onPress={() => setAccountType('personal')}
                style={card(!isBiz)}
                accessibilityRole="radio"
                accessibilityState={{ selected: !isBiz }}
              >
                <Text variant="headline">Personal</Text>
                <Text variant="callout" tone="t2" style={{ marginTop: 4 }}>
                  For you — post, message, look for work, buy things.
                </Text>
              </Pressable>
              <View style={{ height: 12 }} />
              <Pressable
                onPress={() => setAccountType('business')}
                style={card(isBiz)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isBiz }}
              >
                <Text variant="headline">Business</Text>
                <Text variant="callout" tone="t2" style={{ marginTop: 4 }}>
                  For a company — sell, hire, take bookings, get reviewed.
                </Text>
              </Pressable>
              <View style={{ height: 24 }} />
              <Button title="Continue" onPress={() => setStep('you')} />
            </>
          )}

          {step === 'you' && (
            <>
              <Text variant="title" style={{ marginTop: 24 }}>
                {isBiz ? 'About the business' : 'About you'}
              </Text>
              <Text variant="body" tone="t2" style={{ marginTop: 6, marginBottom: 20 }}>
                {isBiz ? 'The name customers will see.' : 'Your name, and the handle people use to find you.'}
              </Text>
              <TextInput
                style={input}
                placeholder={isBiz ? 'Business name' : 'Your name'}
                placeholderTextColor={c.t3}
                value={name}
                onChangeText={setName}
                accessibilityLabel={isBiz ? 'Business name' : 'Your name'}
              />
              <View style={{ height: 12 }} />
              <View style={[input, styles.handleRow]}>
                <Text variant="body" tone="t3">@</Text>
                <TextInput
                  style={[styles.handleInput, { color: c.text }]}
                  placeholder="handle"
                  placeholderTextColor={c.t3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  accessibilityLabel="Handle"
                />
              </View>
              {username.length > 0 && !handleOk && (
                <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>
                  Three to twenty-four characters — letters, numbers and underscores.
                </Text>
              )}
              <View style={{ height: 24 }} />
              <Button title="Continue" onPress={() => setStep('access')} disabled={!name.trim() || !handleOk} />
              <Pressable onPress={() => setStep('kind')} style={styles.back} accessibilityRole="button">
                <Text variant="callout" tone="t3">Back</Text>
              </Pressable>
            </>
          )}

          {step === 'access' && (
            <>
              <Text variant="title" style={{ marginTop: 24 }}>Getting back in</Text>
              <Text variant="body" tone="t2" style={{ marginTop: 6, marginBottom: 20 }}>
                We will send you a note to confirm the address.
              </Text>
              <TextInput
                style={input}
                placeholder="Email"
                placeholderTextColor={c.t3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                accessibilityLabel="Email"
              />
              <View style={{ height: 12 }} />
              <TextInput
                style={input}
                placeholder="Password"
                placeholderTextColor={c.t3}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="Password"
              />
              {password.length > 0 && !passOk && (
                <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>At least eight characters.</Text>
              )}
              {error && <Text variant="caption" tone="danger" style={{ marginTop: 12 }}>{error}</Text>}
              <View style={{ height: 24 }} />
              <Button
                title="Create the account"
                onPress={submit}
                loading={busy}
                disabled={!emailOk || !passOk}
              />
              <Pressable onPress={() => setStep('you')} style={styles.back} accessibilityRole="button">
                <Text variant="callout" tone="t3">Back</Text>
              </Pressable>
            </>
          )}

          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            style={styles.alt}
            accessibilityRole="button"
          >
            <Text variant="callout" tone="t2">
              Already have an account? <Text variant="callout" tone="accent">Log in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handleInput: { flex: 1, fontSize: 16, height: '100%' },
  back: { alignSelf: 'center', marginTop: 16, padding: 8 },
  alt: { alignSelf: 'center', marginTop: 28, padding: 8 },
});
