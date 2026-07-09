import { WorldPlaceholder } from '@/components/WorldPlaceholder';

// Beam — messaging & calls (chats, groups, communities, calls, stories).
// Phase 3 wires /api/atchat/conversations + the realtime `msg`/`typing` events.
export default function Beam() {
  return (
    <WorldPlaceholder
      title="Beam"
      subtitle="Messages, groups, calls and stories — your whole conversation world."
      icon="chatbubbles"
      phase="Phase 3 · Messaging"
    />
  );
}
