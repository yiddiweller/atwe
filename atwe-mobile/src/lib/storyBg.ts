/**
 * The six story backgrounds, matching the web's `_STORY_BGS` exactly.
 *
 * The web stores a preset ID ('g1'…'g6'), not a colour — so a text story posted
 * from a browser arrives here as the string "g3", and the phone's viewer, which
 * only trusted a hex, was painting every one of them plain black. These are the
 * same pairs the web builds its gradients from, with its CSS variables resolved:
 *   --accent #0088FF · --s1 #0B0B0D · --s2 #141416 · --s4 #242426
 *
 * A raw hex is still honoured, since the field is free-form and something else
 * may write one.
 */
export const STORY_BGS: { id: string; colors: [string, string] }[] = [
  { id: 'g1', colors: ['#0088FF', '#0088FF'] },
  { id: 'g2', colors: ['#0088FF', '#242426'] },
  { id: 'g3', colors: ['#141416', '#0088FF'] },
  { id: 'g4', colors: ['#0088FF', '#0088FF'] },
  { id: 'g5', colors: ['#0B0B0D', '#0088FF'] },
  { id: 'g6', colors: ['#141416', '#242426'] },
];

/** The two colours to paint behind a text story, from whatever `bg` holds. */
export function storyGradient(bg: string | null | undefined): [string, string] {
  if (bg && /^#([0-9a-fA-F]{3,8})$/.test(bg)) return [bg, bg];
  const p = STORY_BGS.find((b) => b.id === bg);
  return p ? p.colors : STORY_BGS[0].colors;
}
