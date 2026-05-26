# Pre-Flight Summary: backend/main.py

This file serves as the core FastAPI server. It is approximately 450 lines long. To prevent token window exhaustion, use this summary instead of reading the entire file.

**Key Execution Targets:**
- `migrate_db()` [Lines 23-63]: Handles raw SQLite `ALTER TABLE` statements safely.
- `recalculate_metrics()` [Lines 200-245]: Iterates through workouts to calculate tonnage. This is where TOON tension payload calculations must be injected.
- `GET /api/analytics/trends` [Lines 320-390]: Aggregates weekly metrics.
- **End of File** [Lines 400+]: Location for the new `GET /api/export/csv` route.
