# Technical Execution Plan (Iron Box Terminal)

This document dictates the specific tools, libraries, file structures, and code-level architectural decisions required to build out the active Roadmap Extensions. It answers **what we use, how we use it, and where we use it.**

---

## 1. Viral Social Share & Communication Engine

**Objective**: Allow athletes to seamlessly export beautiful, dynamic summaries of their top sets and trigger haptic audio feedback.

### A. Dynamic Data Card Generator (Social Share)
* **What We Use**: `html2canvas` (or a lightweight equivalent like `html-to-image`) integrated natively into the React frontend.
* **Where We Use It**: `src/components/social/ShareCardGenerator.tsx` (New Directory).
* **How We Use It**: 
    1. We construct a hidden, highly styled HTML node (styled with Tailwind utility classes matching our Obsidian Jade design system) containing the athlete's top lift stats.
    2. We invoke `html-to-image` on this hidden ref, which parses the DOM into a flat PNG/JPEG data payload.
    3. We use the native `navigator.share()` API (Web Share API) to push the payload directly into Instagram/WhatsApp on mobile devices.

### B. Haptic Audio Branding
* **What We Use**: The native HTML5 `AudioContext` API for zero-latency playback.
* **Where We Use It**: `src/services/audioService.ts`.
* **How We Use It**: 
    1. Base64-encoded, highly compressed mechanical click/chime sound files (`.mp3` or `.ogg`) are stored in `src/assets/audio/`.
    2. The `audioService.ts` pre-loads these into browser memory on boot.
    3. We trigger playback exactly when the API returns a `200 OK` on a set log, bypassing network latency.
    4. Combined with `Telegram.WebApp.HapticFeedback` for physical vibration.

---

## 2. Multi-Tiered Biomechanics & Recruitment Engine

**Objective**: Translate exercise variations into Absolute Quantitative Tension Units using Percentage-Deltas and RPE/RIR multipliers.

### A. Database Schema Modifications (Storage Layer)
* **What We Use**: SQLAlchemy ORM in FastAPI + SQLite.
* **Where We Use It**: `backend/database.py` and `backend/models.py`.
* **How We Use It**:
    1. We create a new `BiomechanicsBaseline` table defining baseline lifts (e.g., Squat, Bench, Deadlift).
    2. We create an `ExerciseVariationDelta` table mapping to `exercises`. It contains JSON-encoded or column-based deltas (e.g., `{"Quads": 5.0, "Glutes": -5.0}`).
    3. We implement a similar `AthleteBiomechanicalDelta` for user-specific leverage adjustments.

### B. RPE/RIR Tension Algorithms (Calculation & Analytics Layer)
* **What We Use**: Pure Python math functions executing on the backend during the `POST /api/sync` or `POST /api/workouts/` workflows.
* **Where We Use It**: `backend/math_utils.py` and `backend/main.py`.
* **How We Use It**:
    1. `math_utils.py` receives a new function: `calculate_quantitative_tension(baseline_pct, variation_delta, athlete_delta, tonnage, rpe)`.
    2. We define the **Nonlinear RPE/RIR Multiplier**: An exponential function (e.g., $e^{k(RPE-10)}$) where RPE 10 = 1.0, and RPE 6 ≈ 0.2.
    3. The backend calculates `Adjusted_Pct = Baseline + Variation + Athlete`.
    4. `Quantitative_Unit = Tonnage * Adjusted_Pct * RPE_Multiplier`.
    5. The final Tension Units are saved directly onto the `Workout` or `Microcycle` summary records to ensure high-speed analytics queries, preventing the need to recalculate millions of sets dynamically on every dashboard load.

---

## 3. Spreadsheet / AI Integration Export

**Objective**: Produce flat CSV files for coaches and JSON hierarchies for AI models strictly gated by chronological integrity and lift tiers.

### A. Flat CSV/Excel Exporter
* **What We Use**: Python's native `csv` module and `io.StringIO` for in-memory stream generation.
* **Where We Use It**: A new FastAPI endpoint: `GET /api/export/csv`.
* **How We Use It**:
    1. The API performs a SQLAlchemy query joining `ExerciseSet` -> `Exercise` -> `Workout`.
    2. We construct a matrix prioritizing chronological `Workout.date`.
    3. We strictly enforce the "Data Grouping Gate": Columns are dynamically generated based on `Exercise.lift_category` and `Exercise.tier`. 
    4. The response is returned as a `StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")`.

---

## 4. Execution Workflow (Step-by-Step)

If this Technical Execution Plan is approved, we will build out the components in this exact order:

1. **Phase 1 (Data Layer)**: Modify `backend/database.py` schemas to handle the new Delta tables. Run Alembic or raw SQLite `ALTER TABLE` commands in `main.py` (matching the current migration strategy).
2. **Phase 2 (Math Layer)**: Write the tension algorithms and RPE multipliers in `backend/math_utils.py`. Write extensive unit tests.
3. **Phase 3 (API Layer)**: Update `backend/main.py` endpoints to calculate and return these new quantitative units to the frontend. Implement the CSV export route.
4. **Phase 4 (Frontend Layer)**: Build `ShareCardGenerator.tsx` and integrate the `audioService.ts`. Add UI components to `InsightsView.tsx` to visualize the new Tension Units.
