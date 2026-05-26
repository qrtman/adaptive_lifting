# Iron Box Terminal: Product Roadmap & Active Feature Manifest

This document serves as the master blueprint for the **Iron Box Terminal** periodization system. It defines the core functional architecture, tracks actively implemented features, and outlines future product extensions for elite coaches and athletes.

---

## 1. Active Features (Currently Implemented)

### A. Pragmatic Low-Friction Companion Workspace
- **Integrative WebApp Companion**: A high-fidelity companion logger that meets athletes directly in their existing messaging environments (Telegram WebApp).
- **Hybrid State Architecture**: Robust LocalStorage ↔ SQLite API synchronization.

### B. Core Periodization Engine
- **Fluid Auto-Regulatory Grid**: Drag-and-drop workout scheduling locked within fluid microcycle boundaries (duration can vary beyond strict 7-day weeks).
- **Chronological Tracking**: Workouts strictly tracked against `YYYY-MM-DD` dates for fatigue metric integrity.

### C. Advanced Athlete Logging & Biological Metrics
- **Columnar Prescriptions**: Strict numeric inputs (`planned_weight`, `planned_reps`, `planned_rpe`) avoiding string parsing errors.
- **RTS Math Algorithms**: Brzycki e1RM linear decay with caps, DOTS lifter coefficient calculations.
- **Fatigue Diagnostics**: Acute-Chronic Workload Ratio (ACWR) and Intensity Number of Lifts (INOL).

---

## 2. Roadmap Extensions (Planned / Future)

### A. Viral Social Share & Communication Engine
- **WhatsApp/Telegram Text Copy Engine**: One-click "Copy Workout to Text" for chat recaps.
- **Social Share Card Generator**: Render dynamic digital data cards (HTML5 Canvas/CSS) for top sets.
- **Haptic Audio Branding Sound**: Trigger high-fidelity mechanical click/chime sounds on log completion.

### B. Individualized Muscle Recruitment & Biomechanics (Multi-Tiered Architecture)
To accurately predict hypertrophy and fatigue, the system uses a 3-tier data pipeline balancing database efficiency with physiological accuracy:
1. **Storage Layer (Percentage-Delta Models)**: The database defines a standard compound baseline (e.g., Conventional Deadlift = 35% Hams, 35% Glutes). All variations (e.g., Deficit Deadlift) and athlete biomechanical overrides (e.g., long femurs) are stored purely as positive/negative percentage deltas, keeping the schema extremely lean.
2. **Calculation Layer (Runtime Adjusted Percentages)**: When a set is logged, the engine computes the final adjusted percentage: `Baseline + Variation Delta + Athlete Biomechanical Delta`.
3. **Analytics Layer (Absolute Quantitative Units)**: To prevent AI models from treating relative percentages as absolute physiological stress, the adjusted percentage is multiplied by the set's mechanical workload to output an **Absolute Quantitative Unit** (e.g., "340 Quad Tension Units").

**Factoring Proximity to Failure (RIR/RPE):**
To ensure the AI evaluates true mechanical tension rather than "junk volume," the Quantitative Unit formula applies a **Nonlinear RPE/RIR Tension Multiplier**. Sets performed further from failure (e.g., RPE < 6) recruit fewer high-threshold motor units and yield drastically lower mechanical tension multipliers. As the set approaches RPE 10 (0 RIR), the tension multiplier scales exponentially based on an Effective Reps model, ensuring that only highly stimulating reps generate significant "Tension Units" for downstream AI analysis.

### C. Spreadsheet/AI Integration
- **Flat CSV/Excel Export**: Bulk export of `ExerciseSet` data gated by `lift_category` and `tier` for academic research graphs and pivot tables.
- **Hierarchical JSON Export**: For deep AI analysis.

### D. SaaS Monetization & Program Marketplace
- **Subscription Tiers**: SaaS billing models for coaches.
- **Program Template Marketplace**: Sale of pre-written periodization blocks.

---

## 3. Implementation Plan & Proposed Changes

Below are the key files designated for modification as we implement the **Roadmap Extensions**.

### [Backend Services]
#### [MODIFY] [database.py](backend/database.py)
#### [MODIFY] [math_utils.py](backend/math_utils.py)
#### [MODIFY] [main.py](backend/main.py)

---

### [Frontend Client]
#### [MODIFY] [App.tsx](src/App.tsx)
#### [MODIFY] [CalendarView.tsx](src/components/CalendarView.tsx)
#### [MODIFY] [SessionsView.tsx](src/components/SessionsView.tsx)
#### [MODIFY] [InsightsView.tsx](src/components/InsightsView.tsx)

---

## 4. Verification Plan

### Logical, Export & Authentication Integrity Checks
1. **Spreadsheet Integration Verification**: Ensure CSV exports strictly follow the Data Grouping Gate (`lift_category` + `tier`).
2. **Individualized Muscle Volume Allocation Verification**: Ensure biomechanical overrides correctly adjust tonnage mathematically.
3. **Social Share Sticker Verification**: Ensure PNG export engine functions correctly.
4. **Clipboard Copy Recaps Verification**: Ensure text payload renders smoothly in Telegram/WhatsApp.
5. **Marketplace & Library Verification**: Test SaaS billing paths.
6. **Rescheduling Shifting Test**: Validate microcycle bounds enforcement logic.
