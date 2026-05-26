# Obsidian Kinetic PC-to-PC Transport Blueprint

This manifest serves as a streamlined, zero-garbage blueprint for transferring the active **Obsidian Kinetic Dashboard** codebase to another PC, environment, or clean workspace.

---

## 1. Zero-Garbage Workspace & Clean-Up Policy

The project maintains a strict separation between active code and legacy references. When cloning or zipping this repository for a new environment:

> [!TIP]
> **What to Keep**: Only the `src/`, `backend/`, and the root configuration/documentation files (`README.md`, `architecture.md`, `design.md`, `stitch_design.md`) are required to run the application.

> [!WARNING]
> **What to Ignore/Delete**: Legacy mockups (`*.html`) and stitch developer scripts (`*.py` outside of the backend) are officially deprecated as per the `README.md` archive manifest. Do not attempt to migrate or execute them in the new environment.

---

## 2. PC-to-PC Spin-Up Sequence (PowerShell & Bash)

Once you extract the codebase on your new PC, run these explicit commands.

### Step 1: Frontend Spin-Up
Open your terminal (PowerShell for Windows, Bash for macOS/Linux) in the root workspace folder:

```powershell
# Install dependencies
npm install

# Boot the Vite development server
npm run dev
```
*The frontend is now available at [http://localhost:3000](http://localhost:3000).*

### Step 2: Backend Spin-Up
Open a second terminal window in the root workspace folder.

**Windows (PowerShell):**
```powershell
# Optional: Activate virtual environment if using one
# .\venv\Scripts\Activate.ps1

pip install "fastapi[standard]" sqlalchemy
python -m uvicorn backend.main:app --port 8000 --host 127.0.0.1
```

**macOS/Linux (Bash):**
```bash
# Optional: Activate virtual environment
# source venv/bin/activate

pip install "fastapi[standard]" sqlalchemy
python3 -m uvicorn backend.main:app --port 8000 --host 127.0.0.1
```
*The backend is now running at [http://127.0.0.1:8000](http://127.0.0.1:8000).*

---

## 3. Preserving & Migrating Local State

Obsidian Kinetic uses an automated **local-first** state architecture:
* **Active State Storage**: Training sessions, microcycle progression grids, and roles are cached live in the browser's `localStorage` (`obsidian_microcycles`, `obsidian_role_mode`, etc.).
* **PC Transfer Tip**: If you want to carry over your custom calendar modifications between PCs without backend database sync:
  1. Open F12 DevTools on the source PC.
  2. Go to **Application** -> **Local Storage** -> `http://localhost:3000` (or the active host URL).
  3. Copy the string value of `obsidian_microcycles` and paste it into `localStorage` on the target PC, or let the app fallback to the premium defaults declared in `src/types.ts` automatically.

---

## 4. Post-Launch Verification Checklist

Run these quick checks immediately after launching on a new PC to verify transfer success:
1. [ ] **Start Guard Test**: Confirm that the calendar loads smoothly without a black screen (the startup sanitizer in `App.tsx` has successfully wiped any corrupted browser cache).
2. [ ] **Microcycle Capsule Bounds**: Verify that the planning grid draws continuous colored horizontal capsules spanning strictly from Monday to Sunday of each week.
3. [ ] **Tactile / Rescheduling Checks**: Drag a workout bubble to another day in the same week. Verify that its chronological index (`W•D`) dynamically updates and that a scheduling conflict warning modal is displayed if dropped on an occupied cell.
