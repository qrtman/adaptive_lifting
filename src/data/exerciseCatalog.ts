export type CatalogTier = 'Comp' | 'Variation' | 'Accessory';
export type CatalogCategory = 'Squat' | 'Bench' | 'Deadlift' | 'Other';

export type CatalogEntry = {
  id: string;
  title: string;
  variation: string;
  tier: CatalogTier;
  liftCategory: CatalogCategory;
};

export const EXERCISE_CATALOG: CatalogEntry[] = [
  { id: 'low-bar', title: 'Primary Squat', variation: 'Low Bar Competition', tier: 'Comp', liftCategory: 'Squat' },
  { id: 'comp-bench', title: 'Primary Bench', variation: 'Competition Paused', tier: 'Comp', liftCategory: 'Bench' },
  { id: 'conv-dead', title: 'Primary Deadlift', variation: 'Conventional Deadlift', tier: 'Comp', liftCategory: 'Deadlift' },
  { id: 'high-bar', title: 'Secondary Squat', variation: 'High Bar Olympic', tier: 'Variation', liftCategory: 'Squat' },
  { id: 'ssb', title: 'Secondary Squat', variation: 'SSB Squat', tier: 'Variation', liftCategory: 'Squat' },
  { id: 'pause-squat', title: 'Primary Squat', variation: 'Pause Squat', tier: 'Variation', liftCategory: 'Squat' },
  { id: 'spoto', title: 'Secondary Bench', variation: 'Spoto Press', tier: 'Variation', liftCategory: 'Bench' },
  { id: 'cg-bench', title: 'Tertiary Bench', variation: 'Close Grip Press', tier: 'Variation', liftCategory: 'Bench' },
  { id: 'floor-press', title: 'Secondary Bench', variation: 'Floor Press', tier: 'Variation', liftCategory: 'Bench' },
  { id: 'deficit-dead', title: 'Secondary Deadlift', variation: 'Deficit Deadlift', tier: 'Variation', liftCategory: 'Deadlift' },
  { id: 'rdl', title: 'Secondary Deadlift', variation: 'Romanian Deadlift', tier: 'Variation', liftCategory: 'Deadlift' },
  { id: 'leg-press', title: 'Leg Press', variation: 'Accessory', tier: 'Accessory', liftCategory: 'Other' },
  { id: 'tri-ext', title: 'Triceps Extension', variation: 'Accessory', tier: 'Accessory', liftCategory: 'Other' },
  { id: 'laterals', title: 'Lateral Raises', variation: 'Accessory', tier: 'Accessory', liftCategory: 'Other' },
  { id: 'face-pulls', title: 'Face Pulls', variation: 'Accessory', tier: 'Accessory', liftCategory: 'Other' },
  { id: 'leg-curl', title: 'Leg Curl', variation: 'Accessory', tier: 'Accessory', liftCategory: 'Other' },
];

export function catalogMatches(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.variation.toLowerCase().includes(q) ||
    entry.title.toLowerCase().includes(q) ||
    entry.liftCategory.toLowerCase().includes(q) ||
    entry.tier.toLowerCase().includes(q)
  );
}
