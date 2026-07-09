import { WorldPlaceholder } from '@/components/WorldPlaceholder';

// Atwe AI — the assistant that does things, not just chats.
// Phase 5 wires /api/chat + the agent confirm-card action flow.
export default function AI() {
  return (
    <WorldPlaceholder
      title="Atwe AI"
      subtitle="Your business assistant — ask, draft, analyze, and take actions with your approval."
      icon="sparkles"
      phase="Phase 5 · Assistant"
    />
  );
}
