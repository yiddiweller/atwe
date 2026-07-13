import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

/**
 * The five-world tab bar — rendered by the REAL iOS native tab bar
 * (expo-router native tabs), NOT a JS/blur approximation. On iOS 26 the system
 * itself renders it as authentic Apple **Liquid Glass** (real refraction/specular),
 * and handles the active tint, minimize-on-scroll and safe-area insets natively.
 * Uses the exact web nav glyphs (narch/equals/ring/knot) as tab images; Profile
 * uses the native person SF Symbol.
 *
 * Icon-only: each <Label hidden> hides the text on iOS (the per-label `hidden`
 * prop is cross-platform; `labelVisibilityMode` is Android-only, which is why the
 * bar still showed text). The <Label>s stay for VoiceOver (accessible name), and
 * iOS centers the glyphs in the same native bar.
 */
export default function TabsLayout() {
  return (
    <NativeTabs labelVisibilityMode="unlabeled">
      <NativeTabs.Trigger name="index">
        <Label hidden>Home</Label>
        <Icon src={require('../../assets/nav/home.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="beam">
        <Label hidden>Beam</Label>
        <Icon src={require('../../assets/nav/beam.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="engine">
        <Label hidden>Engine</Label>
        <Icon src={require('../../assets/nav/engine.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ai">
        <Label hidden>Atwe AI</Label>
        <Icon src={require('../../assets/nav/ai.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Label hidden>Profile</Label>
        <Icon sf="person.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
