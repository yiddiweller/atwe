import { WorldPlaceholder } from '@/components/WorldPlaceholder';

// Home — the feed world (For You · Following · Circles · Collections).
// Phase 2 wires /api/social/feed with infinite scroll + the post card.
export default function Home() {
  return (
    <WorldPlaceholder
      title="Home"
      subtitle="Your business feed — For You, Following, Circles and Collections — lands here."
      icon="home"
      phase="Phase 2 · Feed"
    />
  );
}
