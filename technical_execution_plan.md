# Technical Execution Plan (Iron Box Terminal)

This document dictates the specific tools, libraries, file structures, and code-level architectural decisions required to build out the active Roadmap Extensions. It answers **what we use, how we use it, and where we use it.**

> [!WARNING]
> **CRITICAL BOUNDARY ENFORCEMENT & SEARCH BAN**
> **Open-ended codebase searches (e.g., recursive grep or broad scans) are strictly prohibited for the execution agent (the intern).** Every single modification step must target only the exact files and approximate line ranges specified in this document. 

> [!TIP]
> **PRE-FLIGHT CONTEXT SUMMARIES**
> To conserve token windows and prevent context bloat, the execution agent MUST read ackend/main-summary.md and src/App-summary.md instead of parsing the massive raw main.py and App.tsx files. 

---

## 1. Multi-Tiered Biomechanics & Recruitment Engine

**Objective**: Translate exercise variations into Absolute Quantitative Tension Units using Percentage-Deltas and RPE/RIR multipliers.

### A. Database Schema Modifications (Storage Layer)
* **What We Use**: SQLAlchemy ORM in FastAPI + SQLite.
* **Target File & Bounds**:
  * [database.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/database.py)
    * `ExerciseSet` model [approx. lines 87-110]: Add `tension_units_toon = Column(String, nullable=True)` (Using TOON compression).
    * End of file [approx. lines 111-125]: Add the following three declarative SQLite tables:
      1. `BiomechanicsBaseline` (`id`, `lift_category`, `quads`, `glutes`, `hams`, `chest`, `back`)
      2. `ExerciseVariationDelta` (`id`, `variation`, `quads_delta`, `glutes_delta`, `hams_delta`, `chest_delta`, `back_delta`)
      3. `AthleteBiomechanicalDelta` (`id`, `user_id`, `lift_category`, `quads_delta`, `glutes_delta`, `hams_delta`, `chest_delta`, `back_delta`)

### B. Math & Calculation Layer
* **What We Use**: Pure Python mathematical logic.
* **Target File & Bounds**:
  * [math_utils.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/math_utils.py)
    * End of file [approx. line 94+]: Append `calculate_quantitative_tension(weight, reps, rpe, baseline, variation_delta, athlete_delta)`:
      - Exponential RPE proximity multiplier:
        $$T_m = \begin{cases} e^{0.2 \times (\text{RPE} - 10)} & \text{if RPE} \ge 6.0 \\ 0.1 & \text{if RPE} < 6.0 \end{cases}$$
      - Clamped muscle group adjusted percentages: `Adjusted_Pct = clamp(Baseline + Variation_Delta + Athlete_Delta, 0.0, 1.0)`.
      - Absolute Tension Units: `Tension = (Weight * Reps) * Adjusted_Pct * Tension_Multiplier`.
      - **TOON Payload Output**: Format and return the dictionary as a Token-Optimized Object Notation string instead of verbose JSON to compress DB storage and AI context windows. Format: `Q:<val>|G:<val>|H:<val>|C:<val>|B:<val>`.

### C. Backend API Integration & Database Migrations
* **What We Use**: FastAPI controllers + SQLAlchemy sessions.
* **Target File & Bounds**:
  * [main.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/main.py)
    * `migrate_db()` function [approx. lines 23-63]: Modify to execute safe SQLite database modifications (`CREATE TABLE IF NOT EXISTS...` for the three new tables, and `ALTER TABLE exercise_sets ADD COLUMN tension_units_toon VARCHAR` wrapped in try/except). Seed defaults:
      - **Squat**: Quads (0.50), Glutes (0.30), Hams (0.10), Chest (0.00), Back (0.10)
      - **Bench**: Quads (0.00), Glutes (0.00), Hams (0.00), Chest (0.45), Back (0.10)
      - **Deadlift**: Quads (0.15), Glutes (0.35), Hams (0.30), Chest (0.00), Back (0.20)
    * `recalculate_metrics()` function [approx. lines 200-245]: Modify to look up matching biomechanics baselines, variation deltas, and athlete leverage adjustments, compute set-by-set tension units, and write the TOON payload to `s.tension_units_toon`.
    * Trends API `/api/analytics/trends` [approx. lines 320-390]: Update to return weekly aggregated biomechanical loadings per muscle group, parsing the TOON payloads efficiently.

---

## 2. Viral Social Share & Communication Engine

**Objective**: Allow athletes to seamlessly export beautiful, dynamic summaries of their top sets and trigger haptic audio feedback.

### A. Dynamic Data Card Generator (Social Share)
* **What We Use**: HTML5 SVG markup and native text sharing formats.
* **Target File & Bounds**:
  * [NEW] [ShareCardGenerator.tsx](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/components/social/ShareCardGenerator.tsx)
    - Assemble styled card elements conforming to standard Obsidian & HSL design systems.
    - Implement a "Copy Workout to Clipboard" recap button that builds a beautiful text summary:
      `⚡ IRON BOX TERMINAL - Workout summary: [Date] | Top set: [Weight]kg x [Reps] @RPE [RPE] (e1RM [e1RM]kg) | Tension Units: [TOON]`
    - Include a lightweight Canvas/SVG exporter for downloading PNG stickers.

### B. Haptic Audio Branding Service
* **What We Use**: Native HTML5 `AudioContext` synth engine (0KB asset overhead).
* **Target File & Bounds**:
  * [NEW] [audioService.ts](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/services/audioService.ts)
    - Program `playClick()` synthesizing a short mechanical sweep (800Hz to 150Hz over 50ms) using a low-pass filter.
    - Program `playChime()` synthesizing a double-sine wave high success tone (1200Hz then 1800Hz) to represent supercompensation.
  * [App.tsx](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/App.tsx)
    - Import and call `audioService.playClick()` when clicking log items, and `audioService.playChime()` when the set log API returns a `200 OK` successfully.

---

## 3. Spreadsheet / AI Integration Export

**Objective**: Produce flat CSV files for coaches and JSON hierarchies for AI models strictly gated by chronological integrity and lift tiers.

### A. Flat CSV/Excel Exporter
* **What We Use**: Python `csv` stream serialization.
* **Target File & Bounds**:
  * [main.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/main.py)
    - End of file [approx. line 433+]: Add FastAPI route `GET /api/export/csv` joining `ExerciseSet` -> `Exercise` -> `Workout`, sorting chronologically by date.
    - Strictly enforce "Data Grouping Gate": organize headers and data strictly by `lift_category` and `tier` (`Comp` vs `Variation` vs `Accessory`) to avoid naming anomalies.

---

## 4. Execution Workflow (Step-by-Step)

1. **Step 1 (Data Layer & Models)**: Edit [database.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/database.py) to declare models and schema additions.
2. **Step 2 (Database Migrations)**: Modify `migrate_db()` in [main.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/main.py) to handle automatic SQLite setup and baseline seeding.
3. **Step 3 (Mathematical Algorithms)**: Append quantitative tension calculation in [math_utils.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/math_utils.py).
4. **Step 4 (Tension Aggregation)**: Integrate mathematical tension calculations into `recalculate_metrics()` in [main.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/main.py).
5. **Step 5 (Spreadsheet CSV API)**: Implement the streaming CSV export endpoint in [main.py](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/backend/main.py).
6. **Step 6 (Haptic Audio Service)**: Write the synthesizers in [audioService.ts](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/services/audioService.ts) and call them in the logger client.
7. **Step 7 (Social Share Card)**: Create [ShareCardGenerator.tsx](file:///c:/Users/admin/.gemini/antigravity-ide/adaptive_lifting/src/components/social/ShareCardGenerator.tsx) and place it on the dashboard details page.

