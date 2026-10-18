# Repository state and branch policy

## Consolidation checkpoint — 2026-10-18

`main` is the continuation branch after the consolidation PR merges. Use its
README and production status; old branch READMEs are historical snapshots.
This consolidation preserves all source commits through a merge, including:

| Source | Verified pre-cleanup tip |
| --- | --- |
| main | `c4400e1efea6ea79029714291513601ff615d731` |
| recovery | `b75adceca39f55de5d25416379c519ff388f901f` |
| staging E2E | `cb9401beedd646c7f0b3d2db542e210fab0ce128` |
| production bootstrap | `5d7f8a28dfc5a007e02ab248920d6584568532b3` |

Recovery contained the local-save, Supabase staging validation, and production
bootstrap tips. Staging E2E had 16 separate commits; main had 6 separate commits.
Both histories are retained. Six merge conflicts keep the newer recovery code,
its tests/documentation, and the centralized API authorization error handler.
The 401 add-lift behavior is checked by a regression test.

## Workflow boundaries

- Repository validation runs types, frontend tests/build, and recovery unit tests
  without deployment credentials or database access.
- Staging browser validation is manually dispatched on the default branch. It
  deploys to staging and creates/cleans staging fixtures only when explicitly run.
- Synthetic restore and R2 connectivity workflows remain manual-only. The duplicate
  branch-specific synthetic restore workflow is removed.
- Production backup and monitor definitions remain inert `.yml.template` files in
  `scripts/recovery/prepared-workflows/`. Activating them is a separate change.
- No deployed application, production database, credentials, or traffic is changed.

## Cleanup policy

Close an open PR as superseded only when its exact head commit is an ancestor of
consolidated main. Delete an old branch only when its current tip is also an
ancestor; recheck remote tips before deletion. Branches with separate commits
remain for review, even if their PR was historically merged with squash.
Do not force-push or guess that an old feature is redundant from its name.

For future code changes use one short-lived branch per reviewed change from current
main and merge back promptly. Delete the branch after merging. Use commit history
and this checkpoint instead of accumulating continuation branches.

## Pre-cleanup branch inventory

The disposition below is conditional on successful consolidation into main.
Exact tips make cleanup reviewable even after a branch is removed.

| Branch | Recorded tip | Disposition |
| --- | --- | --- |
| `bring-pr39-to-main` | `333616bb806654cf3d22ab450f714597dcd4e364` | Delete after verified merge |
| `coach-planner-design` | `218d4b1fe5e710b218dc4d785c7ca915a4a1be84` | Keep: separate commits require review |
| `cursor/add-lift-search-9f4a` | `b3c9f6a7b6f5552054e47cedb82085d33073ef2c` | Delete after verified merge |
| `cursor/add-lift-search-rule-9f4a` | `27b00e56f167f88fe914b44e00ac7fdd5397db03` | Delete after verified merge |
| `cursor/agent-file-map-rule-9f4a` | `444544f9133c7031b18b45d5983aa7be461058b4` | Delete after verified merge |
| `cursor/athlete-scope-quiet-8a23` | `98287dfae9ceb0e2c1796c7b72bace15f66af288` | Delete after verified merge |
| `cursor/athlete-shared-plans-b64f` | `9c757e63c2291ecf649a4c98ab94db957d83c8b1` | Delete after verified merge |
| `cursor/cal-day-hover-chrome-8a23` | `48ee0593a5b342909b321dccf7cb764e74dbd53d` | Keep: separate commits require review |
| `cursor/cal-theme-scope-map-8a23` | `c1e09d02bbef94391ff5104701ee2deef5e34167` | Delete after verified merge |
| `cursor/cal-theme-shared-8a23` | `b48d86c13f7e5f877516ac127849896f9b2c0167` | Keep: separate commits require review |
| `cursor/calendar-day-notes-9f4a` | `b272fe0198ae7bb926772fc7e4b83a07a02d6ca4` | Delete after verified merge |
| `cursor/calendar-day-notes-rule-9f4a` | `2d5b2a8f5551c36562bc03fb57a596c7b4ba70d0` | Delete after verified merge |
| `cursor/calendar-sheet-surface-9f4a` | `10d23afbdf111378d8cdccb104a2c597723748ae` | Keep: separate commits require review |
| `cursor/drop-reset-plan-8a23` | `15f8336ec56f9c9f5b8aa6a1e5523e3df19cf111` | Keep: separate commits require review |
| `cursor/e1rm-rpe-floor-9f4a` | `1c84dadb5bed189802e6a63ff93b7b2505fba459` | Delete after verified merge |
| `cursor/e1rm-rpe-floor-rule-9f4a` | `41876e3606babf979e948093cfb0b7d45f3a9e28` | Delete after verified merge |
| `cursor/e1rm-rpe-order-9f4a` | `a5ae0b49eeca2a371d3f38616836a35351730e9f` | Delete after verified merge |
| `cursor/exercise-card-layout-7468` | `48d693fa63a5586bfe559b8eea3b131efb6e5c11` | Delete after verified merge |
| `cursor/lift-adj-apply-9f4a` | `fadb7ff77d2927b7c006c249d4d6b2d3ea952214` | Delete after verified merge |
| `cursor/lift-constructor-dialog-9f4a` | `fcfa726f7c9af11dfd006816ccf04789fbd8da69` | Delete after verified merge |
| `cursor/maximized-microcycle-editor-7468` | `00739986b0a92a38420d4bbb1e1c4b1c5d793221` | Keep: separate commits require review |
| `cursor/nav-insights-consolidation-9f4a` | `c8456b5608e172fd6bc184b8276962bfa42a6ae1` | Keep: separate commits require review |
| `cursor/plan-kg-suggest-update-9f4a` | `bb34a9962f234d29884bd91482843a7552c05a4c` | Delete after verified merge |
| `cursor/session-console-dialog-8a23` | `6a85bf33d0249a4ca3bf850237a5c5de96dca3ad` | Keep: separate commits require review |
| `cursor/session-console-grid-header-8a23` | `cbdeb29ceee5cffb1a991dc63fbae611e77b5985` | Keep: separate commits require review |
| `cursor/session-console-hover-filter-8a23` | `a75ba65134aa2001e640caf90df9033b918f493b` | Keep: separate commits require review |
| `cursor/session-console-scope-8a23` | `0b84f96781a70479956c7db60525df5c85e694ad` | Keep: separate commits require review |
| `cursor/session-copy-grains-9f4a` | `b427c09b8eca6b11733956e33a643cd4631a27b1` | Delete after verified merge |
| `cursor/session-day-name-9f4a` | `0bda9479732655200a9c595cf18d5051e1298853` | Delete after verified merge |
| `cursor/session-day-name-rule-9f4a` | `38cac7d4fb2f36a1b1685cca41970be3814a3170` | Keep: separate commits require review |
| `cursor/session-header-labels-9f4a` | `de5c533ca0ddda776d303cbfc147fbf83e957a63` | Delete after verified merge |
| `cursor/sessions-list-scan-8a23` | `8821c7951a54c293a7e8b08e818a0dccbd36458d` | Delete after verified merge |
| `cursor/set-editor-main-surface-9f4a` | `4db363c708ed136e70347d01d62cf959348065dc` | Keep: separate commits require review |
| `cursor/set-pct-adj-column-9f4a` | `ecebf3dbf21cbf51ea69201bd4fd7d2500fb9199` | Keep: separate commits require review |
| `cursor/setup-cloud-env-c238` | `587d3701cf4d698921b5424beb4bb3e0b97c21bb` | Keep: separate commits require review |
| `cursor/shared-athlete-plans-7468` | `5a2a2e056392813cbb29266092ae80f9c9b6c627` | Keep: separate commits require review |
| `cursor/sheets-cell-edit-9f4a` | `d268d791ab61064e7f1decc6185c9e8f93d8fb81` | Delete after verified merge |
| `cursor/sheets-cell-edit-rule-9f4a` | `58d40539c72cc853527f02aa802318e6b3f06737` | Delete after verified merge |
| `cursor/sync-queue-overlay-9f4a` | `8d53e4107702f0a897dc6ea2033bafb58d7b207a` | Keep: separate commits require review |
| `cursor/sync-queue-overlay-restore-9f4a` | `cf52fb8e29b6b6cf807cdb79464918b6eef3610d` | Delete after verified merge |
| `cursor/sync-queue-overlay-rule-9f4a` | `d7b29a0c3ee00ba3c5094da6b8e333f873d7226b` | Keep: separate commits require review |
| `cursor/zahar-athlete-profile-7866` | `587e0ec250166f4452445057c84d6a271877cdf7` | Keep: separate commits require review |
| `feature/exercise-card-refactor` | `c22031567ce0003f045da4dfb8e1e05894910f0d` | Keep: separate commits require review |
| `fridays-late-night-test` | `2ea71065ac53ca1702b34c34e2876086763b5d5d` | Delete after verified merge |
| `local-save` | `29c81fb395c62cc2ac3c775d2a7d8ef3106d9328` | Delete after verified merge |
| `main` | `c4400e1efea6ea79029714291513601ff615d731` | Keep: default branch |
| `production-bootstrap` | `5d7f8a28dfc5a007e02ab248920d6584568532b3` | Delete after verified merge |
| `supabase-staging-validation` | `bed07a12cb767511958601ba0cf49ae32178cd7e` | Delete after verified merge |
| `test/production-recovery-gate` | `b75adceca39f55de5d25416379c519ff388f901f` | Delete after verified merge |
| `test/staging-autonomous-e2e` | `cb9401beedd646c7f0b3d2db542e210fab0ce128` | Delete after verified merge |
