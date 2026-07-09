import { useState } from 'react';
import { View, TextInput, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Real sign-in against the existing backend `/api/auth/login`. Handles the 2FA
 * challenge (401 { twoFactorRequired:true }) by revealing a code field and
 * re-submitting — exactly like the web `doLogin` flow.
 */
export default function Login() {
  const { c, spacing, radius } = useTheme();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await login({ identifier: identifier.trim(), password, code: code || undefined });
      if (res.twoFactorRequired) {
        setNeeds2fa(true);
        setError('Enter your two-factor code to finish signing in.');
      }
      // On success the root guard redirects to (tabs) automatically.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = {
    backgroundColor: c.s2,
    color: c.text,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 16,
  } as const;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={[styles.body, { paddingHorizontal: spacing.xl }]}>
          <Text variant="display" style={{ letterSpacing: 0.5 }}>
            Atwe<Text variant="display" tone="accent">.</Text>
          </Text>
          <Text variant="body" tone="t2" style={{ marginTop: 6, marginBottom: 28 }}>
            Where business gets done.
          </Text>

          <TextInput
            style={input}
            placeholder="Email or @username"
            placeholderTextColor={c.t3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={identifier}
            onChangeText={setIdentifier}
            accessibilityLabel="Email or username"
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

          {needs2fa && (
            <>
              <View style={{ height: 12 }} />
              <TextInput
                style={input}
                placeholder="2FA code"
                placeholderTextColor={c.t3}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
                accessibilityLabel="Two-factor code"
              />
            </>
          )}

          {error && (
            <Text variant="caption" tone="danger" style={{ marginTop: 12 }}>
              {error}
            </Text>
          )}

          <View style={{ height: 24 }} />
          <Button title="Log in" onPress={submit} loading={busy} disabled={!identifier || !password} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, justifyContent: 'center' },
});
