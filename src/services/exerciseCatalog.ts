import type { LiftCategory } from './liftVariation';

export const EXERCISE_CATEGORIES = [
  'Knee Dominant',
  'Hip Dominant',
  'Horizontal Push',
  'Vertical Push',
  'Horizontal Pull',
  'Vertical Pull',
  'Misc',
  'User Defined',
  'Weightlifting',
] as const;

export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export const MOVEMENT_PATTERNS = [
  'Knee Dominant',
  'Hip Dominant',
  'Horizontal Push',
  'Vertical Push',
  'Horizontal Pull',
  'Vertical Pull',
  'Misc',
  'Weightlifting',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export type CatalogExercise = {
  name: string;
  category: ExerciseCategory;
  movementPattern: MovementPattern;
  liftCategory: LiftCategory;
  tier: 'Comp' | 'Variation' | 'Accessory';
};

/** Compact aliases keyed by catalog name. Tokens match these as substrings. */
export const EXERCISE_ALIASES: Record<string, readonly string[]> = {
  RDL: ['romanian', 'romanian deadlift'],
  'SSB Squat': ['ssb', 'safety', 'safety squat', 'safety bar'],
};

function catalogHaystack(item: CatalogExercise): { name: string; other: string[] } {
  const aliases = EXERCISE_ALIASES[item.name] ?? [];
  return {
    name: item.name.toLowerCase(),
    other: [
      item.movementPattern,
      item.category,
      item.liftCategory,
      ...aliases,
    ].map((value) => value.toLowerCase()),
  };
}

function tokenMatches(token: string, item: CatalogExercise): boolean {
  const { name, other } = catalogHaystack(item);
  return name.includes(token) || other.some((field) => field.includes(token));
}

function rowRank(item: CatalogExercise, tokens: string[], query: string): 0 | 1 | 2 {
  const { name } = catalogHaystack(item);
  if (name.startsWith(query) || tokens.some((token) => name.startsWith(token))) return 0;
  if (tokens.every((token) => name.includes(token))) return 1;
  return 2;
}

export const CATALOG_EXERCISES: CatalogExercise[] = [
  { name: 'Squat', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Squat', tier: 'Comp' },
  { name: 'Front Squat', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'Box Squat', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'SSB Squat', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'Split Squat', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Leg Press', category: 'Knee Dominant', movementPattern: 'Knee Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Deadlift', category: 'Hip Dominant', movementPattern: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Comp' },
  { name: 'Sumo Deadlift', category: 'Hip Dominant', movementPattern: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Variation' },
  { name: 'RDL', category: 'Hip Dominant', movementPattern: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Variation' },
  { name: 'Good Morning', category: 'Hip Dominant', movementPattern: 'Hip Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Hip Thrust', category: 'Hip Dominant', movementPattern: 'Hip Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Bench', category: 'Horizontal Push', movementPattern: 'Horizontal Push', liftCategory: 'Bench', tier: 'Comp' },
  { name: 'Close Grip Bench', category: 'Horizontal Push', movementPattern: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Incline Bench', category: 'Horizontal Push', movementPattern: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Floor Press', category: 'Horizontal Push', movementPattern: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Press', category: 'Vertical Push', movementPattern: 'Vertical Push', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Push Press', category: 'Vertical Push', movementPattern: 'Vertical Push', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Chest Supported Row', category: 'Horizontal Pull', movementPattern: 'Horizontal Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Cable Row', category: 'Horizontal Pull', movementPattern: 'Horizontal Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Pull-up', category: 'Vertical Pull', movementPattern: 'Vertical Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Lat Pulldown', category: 'Vertical Pull', movementPattern: 'Vertical Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Curl', category: 'Misc', movementPattern: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Tricep Extension', category: 'Misc', movementPattern: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Face Pull', category: 'Misc', movementPattern: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Clean', category: 'Weightlifting', movementPattern: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Snatch', category: 'Weightlifting', movementPattern: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Jerk', category: 'Weightlifting', movementPattern: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
];

export function filterCatalog(category: ExerciseCategory | '', search: string): CatalogExercise[] {
  if (category === 'User Defined') return [];
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = CATALOG_EXERCISES.filter((item) => {
    if (category && item.category !== category) return false;
    if (tokens.length === 0) return true;
    return tokens.every((token) => tokenMatches(token, item));
  });
  if (tokens.length === 0) return rows;
  const query = tokens.join(' ');
  return [...rows].sort((a, b) => {
    const rankA = rowRank(a, tokens, query);
    const rankB = rowRank(b, tokens, query);
    if (rankA !== rankB) return rankA - rankB;
    return 0;
  });
}
