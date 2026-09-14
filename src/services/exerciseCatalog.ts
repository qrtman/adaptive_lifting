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

export type CatalogExercise = {
  name: string;
  category: ExerciseCategory;
  liftCategory: LiftCategory;
  tier: 'Comp' | 'Variation' | 'Accessory';
};

export const CATALOG_EXERCISES: CatalogExercise[] = [
  { name: 'Squat', category: 'Knee Dominant', liftCategory: 'Squat', tier: 'Comp' },
  { name: 'Front Squat', category: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'Box Squat', category: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'SSB Squat', category: 'Knee Dominant', liftCategory: 'Squat', tier: 'Variation' },
  { name: 'Split Squat', category: 'Knee Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Leg Press', category: 'Knee Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Deadlift', category: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Comp' },
  { name: 'Sumo Deadlift', category: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Variation' },
  { name: 'RDL', category: 'Hip Dominant', liftCategory: 'Deadlift', tier: 'Variation' },
  { name: 'Good Morning', category: 'Hip Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Hip Thrust', category: 'Hip Dominant', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Bench', category: 'Horizontal Push', liftCategory: 'Bench', tier: 'Comp' },
  { name: 'Close Grip Bench', category: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Incline Bench', category: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Floor Press', category: 'Horizontal Push', liftCategory: 'Bench', tier: 'Variation' },
  { name: 'Press', category: 'Vertical Push', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Push Press', category: 'Vertical Push', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Chest Supported Row', category: 'Horizontal Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Cable Row', category: 'Horizontal Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Pull-up', category: 'Vertical Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Lat Pulldown', category: 'Vertical Pull', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Curl', category: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Tricep Extension', category: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Face Pull', category: 'Misc', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Clean', category: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Snatch', category: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
  { name: 'Jerk', category: 'Weightlifting', liftCategory: 'Other', tier: 'Accessory' },
];

export function filterCatalog(category: ExerciseCategory | '', search: string): CatalogExercise[] {
  const q = search.trim().toLowerCase();
  return CATALOG_EXERCISES.filter((item) => {
    if (category && item.category !== category) return false;
    if (category === 'User Defined') return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  });
}
