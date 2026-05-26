# Iron Box Terminal: Knowledge Block (Context Guardian)

*This document serves as the persistent "Active Context Compression" module. It distills key learnings and operational rules for the Antigravity IDE agent to prevent context window bloat and eliminate the "Long Thread Trap."*

---

## 1. Core Directives
- **Functionality First**: Robust state stability and mathematical algorithms take priority over UI aesthetics.
- **Exact Pathing**: All agent tool calls must operate on strictly defined, exact file paths. No blind directory scanning.
- **RAG & Context Defense**: Never ingest heavy compiled outputs or third-party node_modules. `.antigravityignore` protects the agent's context window. Configuration files (`package.json`, `.env`) are explicitly visible to prevent the "Agent Visibility Loop."

## 2. Technical State
- **Stack**: React (TypeScript/Vite), Tailwind v4 (Utility-first), FastAPI (Python), SQLite (SQLAlchemy).
- **Hybrid State**: LocalStorage handles instantaneous UI state; asynchronous debounced syncs push data to FastAPI to prevent UI locking.
- **Data Integrity Gate**: Lift prescriptions use discrete numeric columns (`planned_weight`, `planned_reps`), not strings. Workouts are chronologically bound to `YYYY-MM-DD` for strict fatigue tracking (ACWR/INOL). Variations (e.g., "Paused Deadlift") are tracked discretely via Percentage-Delta mapping to Baseline compounds.

## 3. Current Execution Focus
- **MANAGER PHASE COMPLETE**: The strategic planning, architectural blueprinting, and technical execution specifications are finalized and committed to the workspace.
- We are currently staged to begin **Phase 1: Data Layer Modification** of the Multi-Tiered Biomechanics extension. 
- Execution is strictly bounded by the exact paths defined in `technical_execution_plan.md`. This session is officially wrapped up and ready for GitHub tracking; code generation will proceed in a new "Intern" session to maintain Context Guardian integrity.
