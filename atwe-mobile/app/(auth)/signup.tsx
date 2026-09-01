import { useEffect, useRef, useState } from 'react';
import {
  View, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { AuthButton } from '@/components/AuthButton';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { startSignup, checkSignupCode, resendSignupCode } from '@/api/signup';
import { HapticInput } from '@/components/HapticInput';
import { OtpBoxes } from '@/components/OtpBoxes';
import { DateWheels } from '@/components/DateWheels';
import { haptics } from '@/lib/haptics';

/**
 * Making an account — the web's wizard, step for step, in the web's design: a
 * back arrow, one question, one big borderless field, and Continue pinned to
 * the bottom so it never moves under the thumb.
 *
 * The order is the server's, and it is the order for a reason: the EMAIL is
 * proved first, so nobody fills in a whole form and is only then told the
 * address was already taken or mistyped.
 *
 *   kind → email → code → date of birth → name → password → @username
 *
 * What kind of account comes first because it changes what the questions MEAN:
 * "your name" is a person or a business, and asking afterwards would mean
 * somebody answering the wrong question and being corrected.
 */
type Step = 'kind' | 'email' | 'code' | 'dob' | 'name' | 'password' | 'username';
const ORDER: Step[] = ['kind', 'email', 'code', 'dob', 'name', 'password', 'username'];

export default function Signup() {
  const { c } = useTheme();
  const { signup } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<Step>('kind');
  const [accountType, setAccountType] = useState<'personal' | 'business'>('personal');
  // Arriving from the login screen's "no account with that email" branch, the
  // address is already typed — do not make them type it twice.
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [dob, setDob] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<TextInput>(null);

  /* 30 seconds, the web's number, restarted whenever the code step is entered
     or a new code is asked for. `tick` is what re-arms it on a resend — the
     step has not changed, so the step effect alone would never fire again. */
  const [left, setLeft] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (step !== 'code') return;
    setLeft(30);
    const t = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(t);
  }, [step, tick]);

  useEffect(() => {
    if (step === 'kind') return;
    const t = setTimeout(() => field.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [step]);

  const go = (s: Step) => { setError(null); setStep(s); };
  const back = () => {
    const i = ORDER.indexOf(step);
    if (i <= 0) { router.back(); return; }
    go(ORDER[i - 1]);
  };

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());
  const ready =
    step === 'kind' ? true
    : step === 'email' ? emailOk
    : step === 'code' ? /^\d{6}$/.test(code.trim())
    : step === 'dob' ? dobOk
    : step === 'name' ? name.trim().length > 0
    : step === 'password' ? password.length >= 8
    : true;   // a handle is optional, and can be chosen later

  const next = async () => {
    if (!ready || busy) return;
    setError(null);
    if (step === 'kind') return go('email');
    if (step === 'dob') return go('name');
    if (step === 'name') return go('password');
    if (step === 'password') return go('username');

    setBusy(true);
    try {
      if (step === 'email') { await startSignup(email.trim()); go('code'); }
      else if (step === 'code') { await checkSignupCode(email.trim(), code.trim()); go('dob'); }
      else if (step === 'username') {
        await signup({
          email: email.trim(), code: code.trim(), name: name.trim(), password,
          dob: dob.trim(), accountType,
          ...(username.trim() ? { username: username.trim().replace(/^@/, '') } : {}),
        });
        // The root guard moves to the app once there is a session.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try { await resendSignupCode(email.trim()); setTick((n) => n + 1); setError('A new code is on its way.'); }
    catch (e) { setError((e as Error).message); }
  };

  const title =
    step === 'kind' ? 'What kind of account?'
    : step === 'email' ? "What's your email?"
    : step === 'code' ? 'Enter the code we sent you'
    : step === 'dob' ? "When's your birthday?"
    : step === 'name' ? (accountType === 'business' ? "What's the business called?" : "What's your name?")
    : step === 'password' ? 'Pick a password'
    : 'Pick your @username';

  const sub =
    step === 'email' ? "We'll send you a code to check it's yours."
    /* The web's own words, step for step. */
    : step === 'code' ? 'We sent it to your email to verify.'
    : step === 'dob' ? "We only use this to check if you're old enough."
    : step === 'password' ? 'Password must be at least 8 characters long.'
    : step === 'username' ? 'Your unique name on Atwe. You can change it any time.'
    : null;

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.step} keyboardShouldPersistTaps="handled">
          <View style={styles.stepbar}>
            <Pressable onPress={back} hitSlop={10} style={styles.backArrow}
              accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={30} color={c.text} />
            </Pressable>
          </View>

          <Text style={styles.title}>{title}</Text>
          {!!sub && <Text style={[styles.sub, { color: c.t3 }]}>{sub}</Text>}

          {step === 'kind' ? (
            <View style={{ gap: 12 }}>
              {(['personal', 'business'] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => { haptics.select(); setAccountType(k); }}
                  style={[styles.kind, {
                    backgroundColor: c.s1,
                    borderColor: accountType === k ? c.accent : 'transparent',
                  }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: accountType === k }}
                >
                  <Ionicons
                    name={k === 'business' ? 'business-outline' : 'person-outline'}
                    size={22} color={accountType === k ? c.accent : c.t2}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text variant="headline">{k === 'business' ? 'A business' : 'Just me'}</Text>
                    <Text variant="caption" tone="t3">
                      {k === 'business'
                        ? 'Sell, take bookings and hire.'
                        : 'Post, message, buy and get paid.'}
                    </Text>
                  </View>
                  <Ionicons
                    name={accountType === k ? 'radio-button-on' : 'radio-button-off'}
                    size={20} color={accountType === k ? c.accent : c.t3}
                  />
                </Pressable>
              ))}
            </View>
          ) : step === 'code' ? (
            <>
              <OtpBoxes value={code} onChange={setCode} state={error ? 'bad' : 'idle'} />
              {/* `.auth-resend` — a code that never arrived is the single most
                  common way a signup dies, so the way to ask for another one is
                  on the screen, counting down, rather than hidden. */}
              <Text style={[styles.resend, { color: c.t3 }]}>
                Don't see it?{' '}
                {left > 0 ? (
                  <Text style={[styles.resendOn, { color: c.text }]}>
                    Retry in {left} second{left === 1 ? '' : 's'}
                  </Text>
                ) : (
                  <Text onPress={resend} style={[styles.resendOn, { color: c.text }]}
                    accessibilityRole="button">Resend code</Text>
                )}
              </Text>
            </>
          ) : step === 'dob' ? (
            <>
              {/* The web opens the wheels at ~25 and says the floor underneath
                  rather than starting there — 18 is where the server refuses,
                  not where a typical person's birthday is. */}
              <DateWheels value={dob} onChange={setDob} defaultAge={25} />
              <Text style={[styles.agehint, { color: c.t3 }]}>
                You must be 18 or older to use Atwe.
              </Text>
            </>
          ) : (
            <View style={styles.bigField}>
              {step === 'username' && <Text style={styles.at}>@</Text>}
              <HapticInput
                /* A FRESH native input per step, and this is the whole reason
                   nobody could create an account.

                   One shared TextInput answered all seven questions, so one
                   native UITextField carried the previous step's state across.
                   Coming off the birthday step it held TWO stale things: a
                   `maxLength` of 10 (iOS skips an undefined prop in the diff,
                   so a cap is never cleared, only replaced) and the delegate's
                   predicted text, still the ten characters of "2008-01-01".
                   Every keystroke on "What's your name?" was then measured as
                   10 + 1 against a cap of 10 and refused before it could be
                   drawn. You could type and type and nothing appeared.

                   NB this is native-only — on the web each step renders a
                   fresh DOM <input> and the flow works with or without the
                   key, so a browser preview cannot prove or disprove it.

                   It cannot recur for two independent reasons now: the
                   birthday has its own control, so no maxLength is ever set on
                   this field at all, and the key throws the native view away
                   between questions.

                   Keying it by step throws the native view away and builds a
                   new one, which resets maxLength, keyboardType,
                   secureTextEntry, autoComplete and the buffer together. These
                   are different questions; they should not share a field. */
                key={step}
                ref={field}
                /* Code and birthday have their own controls now, so this field
                   only ever answers four of the questions. TypeScript proved
                   the other branches were dead the moment they moved out. */
                value={
                  step === 'email' ? email
                  : step === 'name' ? name
                  : step === 'password' ? password
                  : username
                }
                onChangeText={
                  step === 'email' ? setEmail
                  : step === 'name' ? setName
                  : step === 'password' ? setPassword
                  : setUsername
                }
                placeholder={
                  step === 'email' ? 'you@example.com'
                  : step === 'name' ? (accountType === 'business' ? 'Fern & Fold' : 'Your name')
                  : step === 'password' ? 'Password'
                  : 'username'
                }
                placeholderTextColor={c.t3}
                secureTextEntry={step === 'password' && !showPw}
                keyboardType={step === 'email' ? 'email-address' : 'default'}
                autoCapitalize={step === 'name' ? 'words' : 'none'}
                autoCorrect={false}
                autoFocus
                autoComplete={
                  step === 'email' ? 'email'
                  : step === 'name' ? 'name'
                  : step === 'password' ? 'new-password'
                  : 'username'
                }
                style={[styles.bigInput, { color: c.text }]}
                onSubmitEditing={next}
                accessibilityLabel={title}
              />
              {step === 'password' && (
                <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={24} color={c.t2} />
                </Pressable>
              )}
            </View>
          )}

          {!!error && <Text style={[styles.err, { color: c.danger }]}>{error}</Text>}

          <View style={styles.grow} />
          <AuthButton
            label={step === 'username' ? (username.trim() ? 'Create account' : 'Skip for now') : 'Continue'}
            primary={ready}
            disabled={!ready || busy}
            onPress={next}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /* Same panel as the login steps — 28px inside a 430 cap. */
  step: {
    flexGrow: 1, paddingHorizontal: 28, paddingBottom: 26,
    maxWidth: 430, width: '100%', alignSelf: 'center',
  },
  stepbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 50, marginBottom: 24,
  },
  backArrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginLeft: -14 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 35, marginBottom: 30 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: -18, marginBottom: 26 },
  bigField: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 43, paddingVertical: 6, marginBottom: 18,
  },
  at: { fontSize: 26, fontWeight: '500' },
  bigInput: { flex: 1, minWidth: 0, fontSize: 26, fontWeight: '500', padding: 0 },
  kind: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.card, padding: 16, borderWidth: 1.5,
  },
  err: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  /* `.su-agehint` */
  agehint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  /* `.auth-resend` + its bolded `b` */
  resend: { fontSize: 14, marginBottom: 6 },
  resendOn: { fontWeight: '700' },
  grow: { flex: 1, minHeight: 24 },
});
