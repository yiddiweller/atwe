import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

/**
 * The five-world tab bar — rendered by the REAL iOS native tab bar
 * (expo-router native tabs), NOT a JS/blur approximation. On iOS 26 the system
 * itself renders it as authentic Apple **Liquid Glass** (real refraction/specular),
 * and handles the active tint, minimize-on-scroll and safe-area insets natively.
 * Uses the exact web nav glyphs (narch/equals/ring/knot) as tab images; Profile
 * uses the native person SF Symbol.
 */
export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon src={require('../../assets/nav/home.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="beam">
        <Label>Beam</Label>
        <Icon src={require('../../assets/nav/beam.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="engine">
        <Label>Engine</Label>
        <Icon src={require('../../assets/nav/engine.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ai">
        <Label>Atwe AI</Label>
        <Icon src={require('../../assets/nav/ai.png')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Label>Profile</Label>
        <Icon sf="person.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
