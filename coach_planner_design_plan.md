# Human-Centric Periodization Planner: Interactive Multi-View Dashboard System

The goal is to transform the existing planner and calendar layout into a highly interactive, beautifully designed, and deeply "human-centric" **Coach Periodization Dashboard**. 

The **Calendar Grid Planner** (Continuous Grid vs. Linear Capsule Row) remains the **master dashboard interface** of the application. The card-based session editor (`ExerciseCard.tsx`) is retained completely for editing workouts, with the launch button labeled as **"EDIT WORKOUT"**.

---

## Visual Design Mockups

To showcase the dashboard layout, here is the premium high-contrast Obsidian master planner grid:

![Coach Calendar Planner Mockup](file:///C:/Users/admin/.gemini/antigravity-ide/brain/e1c194a2-72a6-4459-8ae3-7db4b8da3fb3/coach_calendar_grid_mockup_1779803594824.png)

---

## Detailed Layout Specification: What is Displayed and Where

Below is the structural architecture mapping where every UI component, data metric, and control is positioned on the screen.

### 1. Main Navigation Header (Top Horizontal Bar)
* **Location**: Sticks to the very top of the application viewport (Full Width).
* **Left Section**: 
  - Application title **"Microcycle Manager"** in bold white sans-serif.
  - A horizontal navigation row of toggleable weeks: `Week 1`, `Week 2`, `Week 3`, `Week 4`, `Deload`.
* **Right Section**:
  - Search bar input (Obsidian charcoal background, white text on focus).
  - Clock and History button icons.
  - **Calendar View Switcher**: A glassmorphic toggle group letting coaches switch the planner mode: `Continuous Grid` vs. `Linear Capsule Row`.
  - **Data Layer Selector**: A toggle group letting coaches switch what data is layered over the calendar: **"Exercises View"** (default) vs. **"Trends View (e1RM & Stress Graph)"**.

---

### 2. Microcycle Weekly Row Container (Structured Middle Layer)
To respect the **Microcycle** as an explicit layer positioned between the Block (Mesocycle) and the Session (Day):
* **Location**: In both calendar views, each week is explicitly wrapped inside a distinct visual container representing a **Microcycle Week**.
* **Microcycle Header Bar**: At the top of each weekly container, a horizontal summary bar displays:
  - **Week Title & Focus**: Left-aligned, using authentic powerlifting block focus terminology (e.g., `Microcycle 01 (Focus: Volume Accumulation)`, `Microcycle 02 (Focus: Strength Transition)`, `Microcycle 03 (Focus: Peaking & Taper)`, or `Microcycle 04 (Focus: Active Deload / Recovery)`).
  - **Weekly Volume Tonnage**: e.g., `Weekly Vol: 14,250 kg` (sum of all sets in that week).
  - **Weekly Max e1RM**: Peak calculated e1RM for Squat, Bench, and Deadlift in *that specific week* (e.g., `Max e1RM: SQ 182.5kg | BP 130kg | DL 220kg` in monospace jade green).
  - **Weekly INOL Fatigue Splits**: Calculated Intensity Number of Lifts Splits for the main compounds (e.g. `INOL: SQ 0.85 | BP 0.92 | DL 0.45` in monospace amber).

---

### 3. Main Planner Workspace (Left/Center Scrolling Pane)

#### A. Exercises View (Default Planner Mode)
Renders workouts as visual capsules inside the chronological day cells.

* **Workout Capsule Cards**: Rounded cards representing planned training sessions, designated strictly by their **Primary Compound Focus** (e.g. `Primary: Squat`, `Primary: Bench`, `Primary: Deadlift`, or `Primary: Accessory/GPP`):
    - **Primary Lift Accent Coloring**: The primary lift designation governs the capsule's styling, mapping the border and text highlights to its specific compound profile (RTS Comp Blue for `Squat`, Obsidian Jade Green for `Bench`, CNS Fatigue Orange for `Deadlift`, and Gray for `Accessory/GPP`).
  - **Capsule Header**: Workout title, status dot, and a small yellow-glowing **"Notes" icon** if the session has coach annotations.
  - **Exercise List**: A tight vertical list of exercises in the session, where each row contains:
    - **Movement Name**: The structured result of the SQL relational database fields, displaying modifiers in strict hierarchical order: `[Base Compound] - [Tier Modifier] - [Variation Modifier]` (e.g. `Squat - Competition - Low Bar`, `Bench Press - Paused - Close Grip`, `Deadlift - Deficit`). This matches the SQLite schema exactly and prevents naming drift.
    - **Tier Badge**: A compact badge: `Comp` in RTS blue, `Var` in jade green, or `Acc` in gray.
    - **Prescription Preview**: e.g., `150kg x 4 @ 8` in monospace gray.
    - **Active e1RM (Right Margin)**: The calculated estimated 1RM for that lift from the logged set data (e.g., `e1RM: 163kg` in monospace jade green). This appears next to the exercise name, letting coaches track active strength progression week-over-week directly inside the calendar grid.
  - **Capsule Footer**: Total session tonnage (e.g. `3,450 kg`) and a success tick badge if completed.

#### B. Trends View (e1RM & Stress Graph Mode)
Replaces the text exercise capsules inside the calendar day cells with a sleek strength visual trend-plane:
* **Microcycle Progression Graph**: The weekly row renders a **responsive, linear Multi-Line SVG Line Graph** stretching horizontally across the week's days, plotting:
  - **Squat e1RM path** (blue line)
  - **Bench e1RM path** (green line)
  - **Deadlift e1RM path** (orange line)
  This visualizes strength development curves over the calendar week block.
* **Variation Strength Filtering**:
  - By default, the multi-line strength graph plots the aggregate Max e1RM grouped by the main parent categories (`Squat`, `Bench`, `Deadlift`) to show overall strength development.
  - A small, glassmorphic dropdown is positioned in the trends header: **"Filter Lift: [All Movements | Squat - Competition - Low Bar | Bench Press - Paused | Deadlift - Deficit]"**. Tapping a variation isolates and plots only that specific movement's e1RM progression curve across the active block, tracking strength changes across variations.
* **ACWR Fatigue Gauge**: Displays daily/weekly Acute-Chronic Workload Ratio stress bars (ranging from $0.8$ to $1.3$) directly on day cells, color-coding stress blocks (Green for Safe Load, Amber for High Tension, Red for CNS Overload).

---

### 4. Stitch Detail Side Panel (Right Slide-Out Drawer)
* **Location**: Slides out from the right margin, occupying a fixed 420px width on desktop. It uses spring entry motion (`framer-motion`) and slides over the main calendar workspace.
* **Styling**: `.glass-drawer` (blurred deep charcoal backdrop with a thin semi-transparent white border on the left).
* **Inner Hierarchy (Top to Bottom)**:
  - **Drawer Header**: Displays the workout title, scheduled date, and status. Features a clear `X` close button at the top right.
  - **Summary Row Metrics**: A 3-column container displaying:
    - **Total Tonnage** (total weight × reps logged).
    - **Total Sets Count** (e.g., `Total Sets: 12 (6 Comp, 6 Acc)`).
    - **Max e1RM** (the highest calculated e1RM attained during the session, e.g. `Max e1RM: SQ 182.5kg`).
  - **Exercise Detail Grid**: A clean, read-only table showing a side-by-side view of prescriptions vs. logs:
    - Columns: `EXERCISE` (Title), `TARGET` (Prescribed weight x reps @ RPE), `ACTUAL` (Logged weight x reps @ RPE, or "Pending" in gray).
  - **Coach's Annotations Card**: A dedicated yellow/amber-bordered text block displaying the coach's notes and execution cues for the day. **Location**: Centered directly inside the side panel drawer, positioned right beneath the Exercise Detail Table.
  - **Drawer Footer (Action Buttons)**:
    - A full-width RTS Blue **"EDIT WORKOUT"** button. Clicking this closes the drawer and transitions the main view to the workout session screen.
    - A secondary **"EXPORT"** action button. Tapping this triggers a dropdown to export the workout in two formats:
      - **Spreadsheet CSV**: Conforms strictly to the `lift_category` and `tier` gates to prevent naming drift for academic research graphs.
      - **JSON Payload**: Flat structured JSON for downstream AI analysis.

---

## Proposed Changes

### [Frontend Client Components & Styles]

#### [MODIFY] [index.css](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/index.css)
- Add styling for the right-side sliding glass drawer `.glass-drawer` (`rgba(10, 10, 10, 0.85)` with `backdrop-filter: blur(35px)` and a `border-l border-white/10`).
- Add animations for slide-in drawers and view toggles.

#### [MODIFY] [CalendarView.tsx](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/components/CalendarView.tsx)
- **Implement Continuous vs. Linear Row rendering**:
  - Add state `calendarMode: 'continuous' | 'linear'`, `hideRestDays: boolean`, and `dataLayerMode: 'exercises' | 'trends'`.
- **Implement Microcycle Row Visual Layer**:
  - Render a header bar above each weekly row wrapper showing weekly tonnage volume, weekly Max e1RM values, and INOL splits.
- **Implement Exercises vs. Trends e1RM/Stress Graph rendering**:
  - Under `exercises` layer, render the exercise capsules displaying movement name, prescription, tier, and **active e1RM on the right**.
  - Under `trends` layer, render the Multi-Line SVG line graph charting e1RM curves horizontally across the days (with main compound filters and variation selectors), plus ACWR stress bars.
- **Implement Framer-Motion Stitch Drawer**:
  - Update the drawer layout to feature: Header, Summary Row (Total Sets, Tonnage, Max e1RM), Exercise Table, Coach's Note Card (centered beneath the table), and export dropdown/EDIT WORKOUT buttons.

#### [MODIFY] [App.tsx](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/App.tsx)
- Ensure the layout wrapper structure correctly coordinates the right side drawer's entry.

---

## Verification Plan

### Automated Verification
- Verify that Vite compiles successfully:
  ```powershell
  npm run build
  ```
- Run linter:
  ```powershell
  npm run lint
  ```

### Manual Verification & Playtesting
1. **Coach Calendar Planner**: Verify the upgraded Calendar view, switching between Continuous Grid and Linear Capsule Row, ensuring rest days toggle dynamically.
2. **Data Layer Switcher**: Toggle between "Exercises" and "Trends View". Verify that the text workout cards disappear and are replaced by a clean, horizontal multi-line SVG strength graph (plotting Squat/Bench/Deadlift curves) and ACWR stress bars. Test the variation dropdown filter (e.g. select 'Paused Squat' and check curve updates).
3. **Stitch Drawer Glide**: Click on a workout capsule. Verify the right drawer slides out smoothly using framer-motion, displaying the summary row (Total Sets, Max e1RM), the coach's cue card, and the EDIT WORKOUT button.

