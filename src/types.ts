export interface SetData {
  id: string;
  label: string;
  planned: string;
  plannedWeight: string;
  plannedReps: string;
  plannedRpe: string;
  dropPercent?: number;
  isAuto?: boolean;
  actual?: string;
  reps?: string;
  executedRpe?: string;
  isTop?: boolean;
  note?: string;
  velocity?: string;
  readiness?: string;
  hrv?: string;
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

export interface AccessoryData {
  id: string;
  name: string;
  prescribedSets: string;
  targetReps: string;
  targetRpe: string;
  weight: string;
  reps: string;
  executedRpe: string;
  status: 'Pending' | 'Done';
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
  accessories?: AccessoryData[];
  status: 'Completed' | 'Today' | 'Planned' | 'Testing';
}

export interface MicrocycleData {
  id: string;
  weekName: string; // "Microcycle 01"
  focus: string;
  status: 'Verified' | 'In Progress' | 'Planned';
  active?: boolean;
  workouts: WorkoutData[];
}

export interface MesocycleData {
  id: string;
  name: string;
  status: string;
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
    status: 'Strength Phase • Hypertrophy Block 02',
    color: '#007AFF', // mac-blue
    startDate: '2026-09-01',
    endDate: '2026-09-28',
  },
  {
    id: 'meso-2',
    name: 'Beta-10 Peaking Cycle',
    status: 'Intense Peaking • CNS Adaptation',
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
    status: 'Verified',
    workouts: [
      {
        id: 'w-1-1',
        date: '2026-09-02',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 12400,
        delta: 0,
        color: 'mac-green',
        status: 'Completed',
        exercises: [
          {
            id: 'e-1-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Brace Focus'],
            top: '150kg x 1',
            vol: '8,600kg',
            sets: [
              { id: 's-1-1-1a', label: 'Top Single', planned: '150kg x 1', plannedWeight: '150', plannedReps: '1', plannedRpe: '5', isTop: true, actual: '150', reps: '1', executedRpe: '5' },
              { id: 's-1-1-1b', label: 'Main Set', planned: '137.5kg x 4', plannedWeight: '137.5', plannedReps: '4', plannedRpe: '6', actual: '137.5', reps: '4', executedRpe: '6' },
              { id: 's-1-1-1c', label: 'Backdown', planned: '127.5kg x 4', plannedWeight: '127.5', plannedReps: '4', plannedRpe: '5', note: '-5% Drop', actual: '127.5', reps: '4', executedRpe: '5' }
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
              { id: 's-1-1-2a', label: 'Top Single', planned: '90kg x 3', plannedWeight: '90', plannedReps: '3', plannedRpe: '6', isTop: true, actual: '90', reps: '3', executedRpe: '6' }
            ]
          }
        ],
        accessories: [
          { id: 'a-1-1-1', name: 'Leg Press', prescribedSets: '3', targetReps: '10-12', targetRpe: '7', weight: '120', reps: '12', executedRpe: '7', status: 'Done' }
        ]
      },
      {
        id: 'w-1-2',
        date: '2026-09-04',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 8900,
        delta: 0,
        color: 'mac-green',
        status: 'Completed',
        exercises: [
          {
            id: 'e-1-2-1',
            title: 'Secondary Deadlift',
            variation: 'Deficit Deadlift',
            tags: ['Patience off Floor'],
            top: '180kg x 3',
            vol: '4,700kg',
            sets: [
              { id: 's-1-2-1a', label: 'Top Set', planned: '180kg x 3', plannedWeight: '180', plannedReps: '3', plannedRpe: '6', isTop: true, actual: '180', reps: '3', executedRpe: '6' }
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
              { id: 's-1-2-2a', label: 'Top Set', planned: '85kg x 5', plannedWeight: '85', plannedReps: '5', plannedRpe: '7', isTop: true, actual: '85', reps: '5', executedRpe: '7' }
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
        status: 'Completed',
        exercises: [
          {
            id: 'e-1-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Quads Focus', 'Depth Spec'],
            top: '120kg x 5',
            vol: '5,200kg',
            sets: [
              { id: 's-1-3-1a', label: 'Main Set', planned: '120kg x 5', plannedWeight: '120', plannedReps: '5', plannedRpe: '6', isTop: true, actual: '120', reps: '5', executedRpe: '6' }
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
              { id: 's-1-3-2a', label: 'Main Set', planned: '80kg x 6', plannedWeight: '80', plannedReps: '6', plannedRpe: '6', isTop: true, actual: '80', reps: '6', executedRpe: '6' }
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
    status: 'Verified',
    workouts: [
      {
        id: 'w-2-1',
        date: '2026-09-09',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 13200,
        delta: 800,
        color: 'mac-green',
        status: 'Completed',
        exercises: [
          {
            id: 'e-2-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Quads Drive'],
            top: '155kg x 1',
            vol: '9,200kg',
            sets: [
              { id: 's-2-1-1a', label: 'Top Single', planned: '155kg x 1', plannedWeight: '155', plannedReps: '1', plannedRpe: '5.5', isTop: true, actual: '155', reps: '1', executedRpe: '5.5' }
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
              { id: 's-2-1-2a', label: 'Top Set', planned: '92.5kg x 3', plannedWeight: '92.5', plannedReps: '3', plannedRpe: '6', isTop: true, actual: '92.5', reps: '3', executedRpe: '6' }
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
        status: 'Completed',
        exercises: [
          {
            id: 'e-2-2-1',
            title: 'Secondary Deadlift',
            variation: 'Deficit Deadlift',
            tags: ['Patience off Floor'],
            top: '185kg x 3',
            vol: '4,900kg',
            sets: [
              { id: 's-2-2-1a', label: 'Top Set', planned: '185kg x 3', plannedWeight: '185', plannedReps: '3', plannedRpe: '6', isTop: true, actual: '185', reps: '3', executedRpe: '6' }
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
              { id: 's-2-2-2a', label: 'Top Set', planned: '87.5kg x 5', plannedWeight: '87.5', plannedReps: '5', plannedRpe: '7', isTop: true, actual: '87.5', reps: '5', executedRpe: '7' }
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
        status: 'Completed',
        exercises: [
          {
            id: 'e-2-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Depth Spec'],
            top: '122.5kg x 5',
            vol: '5,500kg',
            sets: [
              { id: 's-2-3-1a', label: 'Main Set', planned: '122.5kg x 5', plannedWeight: '122.5', plannedReps: '5', plannedRpe: '6.5', isTop: true, actual: '122.5', reps: '5', executedRpe: '6.5' }
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
              { id: 's-2-3-2a', label: 'Main Set', planned: '82.5kg x 6', plannedWeight: '82.5', plannedReps: '6', plannedRpe: '6.5', isTop: true, actual: '82.5', reps: '6', executedRpe: '6.5' }
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
    status: 'In Progress',
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
        status: 'Today',
        exercises: [
          {
            id: 'e-3-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Comp Spec', 'Brace Focus', 'Heel Drive'],
            top: '160kg x 1',
            vol: '9,800kg',
            sets: [
              { id: 's-3-1-1a', label: 'Top Single', planned: '160kg x 1', plannedWeight: '160', plannedReps: '1', plannedRpe: '5', isTop: true, actual: '160', reps: '1', executedRpe: '8.5' },
              { id: 's-3-1-1b', label: 'Main Set', planned: '152.5kg x 3', plannedWeight: '152.5', plannedReps: '3', plannedRpe: '6.5', actual: '152.5', reps: '3', executedRpe: '7.5' },
              { id: 's-3-1-1c', label: 'Backdown', planned: '152.5kg x 3', plannedWeight: '152.5', plannedReps: '3', plannedRpe: '5.5', note: '-5% Drop', actual: '152.5', reps: '3', executedRpe: '8' }
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
              { id: 's-3-1-2a', label: 'Top Single', planned: '95kg x 3', plannedWeight: '95', plannedReps: '3', plannedRpe: '5', isTop: true, actual: '95', reps: '3', executedRpe: '8' },
              { id: 's-3-1-2b', label: 'Main Set', planned: '90kg x 5', plannedWeight: '90', plannedReps: '5', plannedRpe: '6', actual: '90', reps: '5', executedRpe: '7' }
            ]
          }
        ],
        accessories: [
          { id: 'a-3-1-1', name: 'Leg Press', prescribedSets: '3', targetReps: '10-12', targetRpe: '7', weight: '120', reps: '12', executedRpe: '7', status: 'Done' },
          { id: 'a-3-1-2', name: 'Triceps Extension', prescribedSets: '3', targetReps: '12', targetRpe: '9', weight: '', reps: '', executedRpe: '', status: 'Pending' },
          { id: 'a-3-1-3', name: 'Lateral Raises', prescribedSets: '3', targetReps: '15', targetRpe: '10', weight: '', reps: '', executedRpe: '', status: 'Pending' }
        ]
      },
      {
        id: 'w-3-2',
        date: '2026-09-18',
        dayLabel: 'D2',
        title: 'Secondary Deadlift, Secondary Bench',
        tonnage: 9900,
        delta: 500,
        color: 'gray',
        status: 'Planned',
        exercises: [
          {
            id: 'e-3-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['Lats Pull', 'Hip Hinge'],
            top: '190kg x 3',
            vol: '5,100kg',
            sets: [
              { id: 's-3-2-1a', label: 'Top Set', planned: '190kg x 3', plannedWeight: '190', plannedReps: '3', plannedRpe: '7', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-3-2-2a', label: 'Main Set', planned: '90kg x 5', plannedWeight: '90', plannedReps: '5', plannedRpe: '7', isTop: true, actual: '', reps: '', executedRpe: '' }
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
        status: 'Planned',
        exercises: [
          {
            id: 'e-3-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Depth Focus'],
            top: '125kg x 5',
            vol: '5,900kg',
            sets: [
              { id: 's-3-3-1a', label: 'Main Set', planned: '125kg x 5', plannedWeight: '125', plannedReps: '5', plannedRpe: '7', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-3-3-2a', label: 'Main Set', planned: '85kg x 6', plannedWeight: '85', plannedReps: '6', plannedRpe: '7', isTop: true, actual: '', reps: '', executedRpe: '' }
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
    status: 'Planned',
    workouts: [
      {
        id: 'w-4-1',
        date: '2026-09-23',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 14800,
        delta: 700,
        color: 'gray',
        status: 'Planned',
        exercises: [
          {
            id: 'e-4-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Max Strain'],
            top: '162.5kg x 1',
            vol: '10,200kg',
            sets: [
              { id: 's-4-1-1a', label: 'Top Single', planned: '162.5kg x 1', plannedWeight: '162.5', plannedReps: '1', plannedRpe: '6', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-4-1-2a', label: 'Top Set', planned: '97.5kg x 3', plannedWeight: '97.5', plannedReps: '3', plannedRpe: '7', isTop: true, actual: '', reps: '', executedRpe: '' }
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
        status: 'Planned',
        exercises: [
          {
            id: 'e-4-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['Hip Power'],
            top: '195kg x 3',
            vol: '5,300kg',
            sets: [
              { id: 's-4-2-1a', label: 'Top Set', planned: '195kg x 3', plannedWeight: '195', plannedReps: '3', plannedRpe: '7.5', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-4-2-2a', label: 'Main Set', planned: '92.5kg x 5', plannedWeight: '92.5', plannedReps: '5', plannedRpe: '7.5', isTop: true, actual: '', reps: '', executedRpe: '' }
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
        status: 'Planned',
        exercises: [
          {
            id: 'e-4-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['Quads Strength'],
            top: '130kg x 5',
            vol: '6,200kg',
            sets: [
              { id: 's-4-3-1a', label: 'Main Set', planned: '130kg x 5', plannedWeight: '130', plannedReps: '5', plannedRpe: '7.5', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-4-3-2a', label: 'Main Set', planned: '87.5kg x 6', plannedWeight: '87.5', plannedReps: '6', plannedRpe: '7.5', isTop: true, actual: '', reps: '', executedRpe: '' }
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
    status: 'Planned',
    workouts: [
      {
        id: 'w-5-1',
        date: '2026-09-30',
        dayLabel: 'D1',
        title: 'Primary Squat, Primary Bench',
        tonnage: 15300,
        delta: 500,
        color: 'orange',
        status: 'Testing',
        exercises: [
          {
            id: 'e-5-1-1',
            title: 'Primary Squat',
            variation: 'Low Bar Competition',
            tags: ['Heavy Single Lock'],
            top: '165kg x 1',
            vol: '5,000kg',
            sets: [
              { id: 's-5-1-1a', label: 'Top Single', planned: '165kg x 1', plannedWeight: '165', plannedReps: '1', plannedRpe: '8', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-5-1-2a', label: 'Top Single', planned: '100kg x 1', plannedWeight: '100', plannedReps: '1', plannedRpe: '8', isTop: true, actual: '', reps: '', executedRpe: '' }
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
        status: 'Testing',
        exercises: [
          {
            id: 'e-5-2-1',
            title: 'Secondary Deadlift',
            variation: 'Conventional Deadlift',
            tags: ['CNS Priming'],
            top: '200kg x 1',
            vol: '5,500kg',
            sets: [
              { id: 's-5-2-1a', label: 'Top Single', planned: '200kg x 1', plannedWeight: '200', plannedReps: '1', plannedRpe: '8.5', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-5-2-2a', label: 'Top Set', planned: '95kg x 3', plannedWeight: '95', plannedReps: '3', plannedRpe: '8', isTop: true, actual: '', reps: '', executedRpe: '' }
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
        status: 'Testing',
        exercises: [
          {
            id: 'e-5-3-1',
            title: 'Secondary Squat',
            variation: 'High Bar Olympic',
            tags: ['CNS Tuning'],
            top: '135kg x 3',
            vol: '6,100kg',
            sets: [
              { id: 's-5-3-1a', label: 'Top Set', planned: '135kg x 3', plannedWeight: '135', plannedReps: '3', plannedRpe: '8', isTop: true, actual: '', reps: '', executedRpe: '' }
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
              { id: 's-5-3-2a', label: 'Top Set', planned: '90kg x 5', plannedWeight: '90', plannedReps: '5', plannedRpe: '8', isTop: true, actual: '', reps: '', executedRpe: '' }
            ]
          }
        ]
      }
    ]
  }
];
