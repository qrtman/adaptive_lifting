export interface SetData {
  id: string;
  label: string;
  plannedWeight: number | null;
  plannedReps: number | null;
  plannedRpe: number | null;
  dropPercent?: number;
  isAuto?: boolean;
  actual?: number | null;
  reps?: number | null;
  executedRpe?: number | null;
  isTop?: boolean;
  note?: string;
  velocity?: number | null;
  readiness?: number | null;
  hrv?: number | null;

  intensity_type?: 'RPE' | 'PERCENT';
  target_value?: number;
  adjustment_pct?: number;
  baseline_e1rm?: number;
}

export interface ExerciseData {
  id: string;
  title: string;
  variation: string;
  tier?: 'Comp' | 'Variation' | 'Accessory';
  liftCategory?: 'Squat' | 'Bench' | 'Deadlift' | 'Other';
  tags: string[];
  top: string;
  vol: string;
  sets: SetData[];
}

export function isAccessoryExercise(exercise: ExerciseData): boolean {
  return exercise.tier === 'Accessory';
}

export function splitWorkoutExercises(exercises: ExerciseData[]): {
  main: ExerciseData[];
  accessories: ExerciseData[];
} {
  const main: ExerciseData[] = [];
  const accessories: ExerciseData[] = [];
  for (const exercise of exercises) {
    if (isAccessoryExercise(exercise)) accessories.push(exercise);
    else main.push(exercise);
  }
  return { main, accessories };
}

function accessoryExercise(
  id: string,
  title: string,
  setCount: number,
  plannedReps: number,
  plannedRpe: number,
  plannedWeight: number | null,
  logged?: { actual: number; reps: number; rpe: number }
): ExerciseData {
  const sets: SetData[] = Array.from({ length: setCount }, (_, index) => ({
    id: `${id}-s${index + 1}`,
    label: `Set ${index + 1}`,
    plannedWeight,
    plannedReps,
    plannedRpe,
    actual: logged?.actual ?? null,
    reps: logged?.reps ?? null,
    executedRpe: logged?.rpe ?? null,
  }));
  return {
    id,
    title,
    variation: 'Accessory',
    tier: 'Accessory',
    liftCategory: 'Other',
    tags: ['Accessory'],
    top: logged ? `${logged.actual}kg x ${logged.reps}` : '—',
    vol: logged && plannedWeight ? `${(logged.actual * logged.reps * setCount).toLocaleString()}kg` : '—',
    sets,
  };
}

export type MesocycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
export type MicrocycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
export type WorkoutStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED';

export function isWorkoutCompleted(status: string): boolean {
  return status === 'COMPLETED' || status === 'Completed';
}

export function isWorkoutInProgress(status: string): boolean {
  return status === 'IN_PROGRESS' || status === 'Today';
}

export function isMicrocycleCompleted(status: string): boolean {
  return status === 'COMPLETED' || status === 'Verified';
}

export function isMicrocycleActive(status: string): boolean {
  return status === 'ACTIVE' || status === 'In Progress';
}

export interface WorkoutData {
  id: string;
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "D1"
  title: string;
  athleteBw?: number;
  tonnage: number;
  delta: number;
  color: 'mac-green' | 'mac-blue' | 'orange' | 'gray';
  exercises: ExerciseData[];
  status: WorkoutStatus;
}

export interface MicrocycleData {
  id: string;
  weekName: string; // "Microcycle 01"
  focus: string;
  status: MicrocycleStatus;
  active?: boolean;
  workouts: WorkoutData[];
}

export interface MesocycleData {
  id: string;
  name: string;
  status: MesocycleStatus;
  color: string; // css classes or raw colors, e.g. "border-mac-blue text-mac-blue"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

// September 2026 calendar starts on Tuesday (September 1, 2026 is Tuesday)
// We will mock workouts distributed in September 2026.
export const INITIAL_MESOCYCLE: MesocycleData[] = [
  {
    id: 'meso-1',
    name: 'Alpha-09 Strength Phase',
    status: 'ACTIVE',
    color: '#007AFF', // mac-blue
    startDate: '2026-09-01',
    endDate: '2026-09-28',
  },
  {
    id: 'meso-2',
    name: 'Beta-10 Peaking Cycle',
    status: 'DRAFT',
    color: '#34C759', // mac-green
    startDate: '2026-09-29',
    endDate: '2026-10-15',
  }
];

export const INITIAL_MICROCYCLES: MicrocycleData[] = [
  {
    id: 'micro-1',
    weekName: 'Microcycle 01',
    focus: 'Technical Proficiency / Baseline',
    status: 'COMPLETED',
    workouts: [
      {
        id: 'w-1-1',
        date: '2026-09-02',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 12400,
        delta: 0,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-1-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Brace Focus'],
            top: '150kg x 1',
            vol: '8,600kg',
            sets: [
              { id: 's-1-1-1a', label: 'Top Single', plannedWeight: 150.0, plannedReps: 1.0, plannedRpe: 5.0, isTop: true, actual: 150.0, reps: 1.0, executedRpe: 5.0 },
              { id: 's-1-1-1b', label: 'Main Set', plannedWeight: 137.5, plannedReps: 4.0, plannedRpe: 6.0, actual: 137.5, reps: 4.0, executedRpe: 6.0 },
              { id: 's-1-1-1c', label: 'Backdown', plannedWeight: 127.5, plannedReps: 4.0, plannedRpe: 5.0, note: '-5% Drop', actual: 127.5, reps: 4.0, executedRpe: 5.0 }
            ]
          },
          {
            id: 'e-1-1-2',
            title: 'Primary Bench',
            variation: 'Competition Paused',
            tags: ['Static Leg Drive', '1-sec Pause'],
            top: '90kg x 3',
            vol: '3,800kg',
            sets: [
              { id: 's-1-1-2a', label: 'Top Single', plannedWeight: 90.0, plannedReps: 3.0, plannedRpe: 6.0, isTop: true, actual: 90.0, reps: 3.0, executedRpe: 6.0 }
            ]
          },
          accessoryExercise('a-1-1-1', 'Leg Press', 3, 10, 7, 120, { actual: 120, reps: 12, rpe: 7 })
        ],
      },
      {
        id: 'w-1-2',
        date: '2026-09-04',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 8900,
        delta: 0,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-1-2-1',
            title: 'Secondary Deadlift',
            variation: 'Deficit Deadlift',
            tags: ['Patience off Floor'],
            top: '180kg x 3',
            vol: '4,700kg',
            sets: [
              { id: 's-1-2-1a', label: 'Top Set', plannedWeight: 180.0, plannedReps: 3.0, plannedRpe: 6.0, isTop: true, actual: 180.0, reps: 3.0, executedRpe: 6.0 }
            ]
          },
          {
            id: 'e-1-2-2',
            title: 'Secondary Bench',
            variation: 'Spoto Press',
            tags: ['Hover Focus', 'Chest Activation'],
            top: '85kg x 5',
            vol: '4,200kg',
            sets: [
              { id: 's-1-2-2a', label: 'Top Set', plannedWeight: 85.0, plannedReps: 5.0, plannedRpe: 7.0, isTop: true, actual: 85.0, reps: 5.0, executedRpe: 7.0 }
            ]
          }
        ]
      },
      {
        id: 'w-1-3',
        date: '2026-09-06',
        dayLabel: 'D3',
        title: 'Secondary Squat, Tertiary Bench',
        tonnage: 11200,
        delta: 0,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-1-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Quads Focus', 'Depth Spec'],
            top: '120kg x 5',
            vol: '5,200kg',
            sets: [
              { id: 's-1-3-1a', label: 'Main Set', plannedWeight: 120.0, plannedReps: 5.0, plannedRpe: 6.0, isTop: true, actual: 120.0, reps: 5.0, executedRpe: 6.0 }
            ]
          },
          {
            id: 'e-1-3-2',
            title: 'Tertiary Bench',
            variation: 'Close Grip Press',
            tags: ['Triceps Isolation'],
            top: '80kg x 6',
            vol: '6,000kg',
            sets: [
              { id: 's-1-3-2a', label: 'Main Set', plannedWeight: 80.0, plannedReps: 6.0, plannedRpe: 6.0, isTop: true, actual: 80.0, reps: 6.0, executedRpe: 6.0 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'micro-2',
    weekName: 'Microcycle 02',
    focus: 'Accumulation / Volume Expansion',
    status: 'COMPLETED',
    workouts: [
      {
        id: 'w-2-1',
        date: '2026-09-09',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 13200,
        delta: 800,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-2-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Quads Drive'],
            top: '155kg x 1',
            vol: '9,200kg',
            sets: [
              { id: 's-2-1-1a', label: 'Top Single', plannedWeight: 155.0, plannedReps: 1.0, plannedRpe: 5.5, isTop: true, actual: 155.0, reps: 1.0, executedRpe: 5.5 }
            ]
          },
          {
            id: 'e-2-1-2',
            title: 'Primary Bench',
            variation: 'Competition Paused',
            tags: ['Static Leg Drive'],
            top: '92.5kg x 3',
            vol: '4,000kg',
            sets: [
              { id: 's-2-1-2a', label: 'Top Set', plannedWeight: 92.5, plannedReps: 3.0, plannedRpe: 6.0, isTop: true, actual: 92.5, reps: 3.0, executedRpe: 6.0 }
            ]
          }
        ]
      },
      {
        id: 'w-2-2',
        date: '2026-09-11',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 9400,
        delta: 500,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-2-2-1',
            title: 'Secondary Deadlift',
            variation: 'Deficit Deadlift',
            tags: ['Patience off Floor'],
            top: '185kg x 3',
            vol: '4,900kg',
            sets: [
              { id: 's-2-2-1a', label: 'Top Set', plannedWeight: 185.0, plannedReps: 3.0, plannedRpe: 6.0, isTop: true, actual: 185.0, reps: 3.0, executedRpe: 6.0 }
            ]
          },
          {
            id: 'e-2-2-2',
            title: 'Secondary Bench',
            variation: 'Spoto Press',
            tags: ['Hover Focus'],
            top: '87.5kg x 5',
            vol: '4,500kg',
            sets: [
              { id: 's-2-2-2a', label: 'Top Set', plannedWeight: 87.5, plannedReps: 5.0, plannedRpe: 7.0, isTop: true, actual: 87.5, reps: 5.0, executedRpe: 7.0 }
            ]
          }
        ]
      },
      {
        id: 'w-2-3',
        date: '2026-09-13',
        dayLabel: 'D3',
        title: 'Secondary Squat, Tertiary Bench',
        tonnage: 11800,
        delta: 600,
        color: 'mac-green',
        status: 'COMPLETED',
        exercises: [
          {
            id: 'e-2-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Depth Spec'],
            top: '122.5kg x 5',
            vol: '5,500kg',
            sets: [
              { id: 's-2-3-1a', label: 'Main Set', plannedWeight: 122.5, plannedReps: 5.0, plannedRpe: 6.5, isTop: true, actual: 122.5, reps: 5.0, executedRpe: 6.5 }
            ]
          },
          {
            id: 'e-2-3-2',
            title: 'Tertiary Bench',
            variation: 'Close Grip Press',
            tags: ['Triceps Work'],
            top: '82.5kg x 6',
            vol: '6,300kg',
            sets: [
              { id: 's-2-3-2a', label: 'Main Set', plannedWeight: 82.5, plannedReps: 6.0, plannedRpe: 6.5, isTop: true, actual: 82.5, reps: 6.0, executedRpe: 6.5 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'micro-3',
    weekName: 'Microcycle 03',
    focus: 'Threshold / Intensity Peak',
    status: 'ACTIVE',
    active: true,
    workouts: [
      {
        id: 'w-3-1',
        date: '2026-09-16',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 14100,
        delta: 900,
        color: 'mac-blue',
        status: 'IN_PROGRESS',
        exercises: [
          {
            id: 'e-3-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Brace Focus', 'Heel Drive'],
            top: '160kg x 1',
            vol: '9,800kg',
            sets: [
              { id: 's-3-1-1a', label: 'Top Single', plannedWeight: 160.0, plannedReps: 1.0, plannedRpe: 5.0, isTop: true, actual: 160.0, reps: 1.0, executedRpe: 8.5 },
              { id: 's-3-1-1b', label: 'Main Set', plannedWeight: 152.5, plannedReps: 3.0, plannedRpe: 6.5, actual: 152.5, reps: 3.0, executedRpe: 7.5 },
              { id: 's-3-1-1c', label: 'Backdown', plannedWeight: 152.5, plannedReps: 3.0, plannedRpe: 5.5, note: '-5% Drop', actual: 152.5, reps: 3.0, executedRpe: 8.0 }
            ]
          },
          {
            id: 'e-3-1-2',
            title: 'Primary Bench',
            variation: 'Competition Paused',
            tags: ['Static Leg Drive', '1-sec Pause', 'Shoulder Pin'],
            top: '95kg x 3',
            vol: '4,300kg',
            sets: [
              { id: 's-3-1-2a', label: 'Top Single', plannedWeight: 95.0, plannedReps: 3.0, plannedRpe: 5.0, isTop: true, actual: 95.0, reps: 3.0, executedRpe: 8.0 },
              { id: 's-3-1-2b', label: 'Main Set', plannedWeight: 90.0, plannedReps: 5.0, plannedRpe: 6.0, actual: 90.0, reps: 5.0, executedRpe: 7.0 }
            ]
          },
          accessoryExercise('a-3-1-1', 'Leg Press', 3, 10, 7, 120, { actual: 120, reps: 12, rpe: 7 }),
          accessoryExercise('a-3-1-2', 'Triceps Extension', 3, 12, 9, null),
          accessoryExercise('a-3-1-3', 'Lateral Raises', 3, 15, 10, null)
        ],
      },
      {
        id: 'w-3-2',
        date: '2026-09-18',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 9900,
        delta: 500,
        color: 'gray',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-3-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['Lats Pull', 'Hip Hinge'],
            top: '190kg x 3',
            vol: '5,100kg',
            sets: [
              { id: 's-3-2-1a', label: 'Top Set', plannedWeight: 190.0, plannedReps: 3.0, plannedRpe: 7.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-3-2-2',
            title: 'Secondary Bench',
            variation: 'Spoto Press',
            tags: ['Hover Focus'],
            top: '90kg x 5',
            vol: '4,800kg',
            sets: [
              { id: 's-3-2-2a', label: 'Main Set', plannedWeight: 90.0, plannedReps: 5.0, plannedRpe: 7.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      },
      {
        id: 'w-3-3',
        date: '2026-09-20',
        dayLabel: 'D3',
        title: 'Secondary Squat, Tertiary Bench',
        tonnage: 12500,
        delta: 700,
        color: 'gray',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-3-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Depth Focus'],
            top: '125kg x 5',
            vol: '5,900kg',
            sets: [
              { id: 's-3-3-1a', label: 'Main Set', plannedWeight: 125.0, plannedReps: 5.0, plannedRpe: 7.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-3-3-2',
            title: 'Tertiary Bench',
            variation: 'Close Grip Press',
            tags: ['Triceps Push'],
            top: '85kg x 6',
            vol: '6,600kg',
            sets: [
              { id: 's-3-3-2a', label: 'Main Set', plannedWeight: 85.0, plannedReps: 6.0, plannedRpe: 7.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'micro-4',
    weekName: 'Microcycle 04',
    focus: 'Overreach / Final Exposure',
    status: 'DRAFT',
    workouts: [
      {
        id: 'w-4-1',
        date: '2026-09-23',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 14800,
        delta: 700,
        color: 'gray',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-4-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Max Strain'],
            top: '162.5kg x 1',
            vol: '10,200kg',
            sets: [
              { id: 's-4-1-1a', label: 'Top Single', plannedWeight: 162.5, plannedReps: 1.0, plannedRpe: 6.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-4-1-2',
            title: 'Primary Bench',
            variation: 'Competition Paused',
            tags: ['Leg Drive Peak'],
            top: '97.5kg x 3',
            vol: '4,600kg',
            sets: [
              { id: 's-4-1-2a', label: 'Top Set', plannedWeight: 97.5, plannedReps: 3.0, plannedRpe: 7.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      },
      {
        id: 'w-4-2',
        date: '2026-09-25',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 10400,
        delta: 500,
        color: 'gray',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-4-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['Hip Power'],
            top: '195kg x 3',
            vol: '5,300kg',
            sets: [
              { id: 's-4-2-1a', label: 'Top Set', plannedWeight: 195.0, plannedReps: 3.0, plannedRpe: 7.5, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-4-2-2',
            title: 'Secondary Bench',
            variation: 'Spoto Press',
            tags: ['Hover Focus'],
            top: '92.5kg x 5',
            vol: '5,100kg',
            sets: [
              { id: 's-4-2-2a', label: 'Main Set', plannedWeight: 92.5, plannedReps: 5.0, plannedRpe: 7.5, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      },
      {
        id: 'w-4-3',
        date: '2026-09-27',
        dayLabel: 'D3',
        title: 'Secondary Squat, Tertiary Bench',
        tonnage: 13100,
        delta: 600,
        color: 'gray',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-4-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Quads Strength'],
            top: '130kg x 5',
            vol: '6,200kg',
            sets: [
              { id: 's-4-3-1a', label: 'Main Set', plannedWeight: 130.0, plannedReps: 5.0, plannedRpe: 7.5, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-4-3-2',
            title: 'Tertiary Bench',
            variation: 'Close Grip Press',
            tags: ['Close Arm Drive'],
            top: '87.5kg x 6',
            vol: '6,900kg',
            sets: [
              { id: 's-4-3-2a', label: 'Main Set', plannedWeight: 87.5, plannedReps: 6.0, plannedRpe: 7.5, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'micro-5',
    weekName: 'Microcycle 05',
    focus: 'Peaking Phase Start',
    status: 'DRAFT',
    workouts: [
      {
        id: 'w-5-1',
        date: '2026-09-30',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 15300,
        delta: 500,
        color: 'orange',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-5-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Heavy Single Lock'],
            top: '165kg x 1',
            vol: '5,000kg',
            sets: [
              { id: 's-5-1-1a', label: 'Top Single', plannedWeight: 165.0, plannedReps: 1.0, plannedRpe: 8.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-5-1-2',
            title: 'Primary Bench',
            variation: 'Competition Paused',
            tags: ['Heavy Single Paused'],
            top: '100kg x 1',
            vol: '3,000kg',
            sets: [
              { id: 's-5-1-2a', label: 'Top Single', plannedWeight: 100.0, plannedReps: 1.0, plannedRpe: 8.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      },
      {
        id: 'w-5-2',
        date: '2026-10-02',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 11000,
        delta: 200,
        color: 'orange',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-5-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['CNS Priming'],
            top: '200kg x 1',
            vol: '5,500kg',
            sets: [
              { id: 's-5-2-1a', label: 'Top Single', plannedWeight: 200.0, plannedReps: 1.0, plannedRpe: 8.5, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-5-2-2',
            title: 'Secondary Bench',
            variation: 'Spoto Press',
            tags: ['Hover Focus'],
            top: '95kg x 3',
            vol: '4,000kg',
            sets: [
              { id: 's-5-2-2a', label: 'Top Set', plannedWeight: 95.0, plannedReps: 3.0, plannedRpe: 8.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      },
      {
        id: 'w-5-3',
        date: '2026-10-04',
        dayLabel: 'D3',
        title: 'Secondary Squat, Tertiary Bench',
        tonnage: 12100,
        delta: 300,
        color: 'orange',
        status: 'PLANNED',
        exercises: [
          {
            id: 'e-5-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['CNS Tuning'],
            top: '135kg x 3',
            vol: '6,100kg',
            sets: [
              { id: 's-5-3-1a', label: 'Top Set', plannedWeight: 135.0, plannedReps: 3.0, plannedRpe: 8.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          },
          {
            id: 'e-5-3-2',
            title: 'Tertiary Bench',
            variation: 'Close Grip Press',
            tags: ['Triceps Final Tune'],
            top: '90kg x 5',
            vol: '6,000kg',
            sets: [
              { id: 's-5-3-2a', label: 'Top Set', plannedWeight: 90.0, plannedReps: 5.0, plannedRpe: 8.0, isTop: true, actual: null, reps: null, executedRpe: null }
            ]
          }
        ]
      }
    ]
  }
];

export interface AICoachResponse {
  cns_readiness: {
    status: 'Functional Adaptation' | 'Neural Fatigue Suppression' | 'Detraining';
    score: number; // 0-100 neural score
    analysis: string; // Exactly two sentences explaining the ACWR ratio
  };
  movement_diagnostics: {
    squat_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
    bench_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
    deadlift_fatigue: { status: 'Optimal' | 'Caution' | 'Danger'; inol: number; warning: string };
  };
  microcycle_prescription: {
    loading_strategy: 'Maintain Baseline' | 'Escalate Tonnage (+10%)' | 'Load Drop Downsets (-5%)' | 'Deload Decompression (-20%)';
    tactical_guidance: string; // Actionable RTS periodization guidelines
    suggested_rpe_cap: number; // e.g. 8.0, 8.5, 9.0
  };
  attempt_feedback: {
    opener_feasibility: 'Conservative' | 'Optimal' | 'High-Risk';
    coaching_notes: string; // Analysis of attempt jumps
  };
}

