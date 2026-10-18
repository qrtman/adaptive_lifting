# Remaining branch review — 2026-10-19

Task: retire proven duplicate branches while retaining all original commits and
separate work that still requires a product decision.

Source of truth: `architecture.md` selected runtime and sections 7–10 (state,
flows, authorization, API), `design.md` sections 6.1–6.2 and 11 (calendar,
session editor, keyboard), and `knowledge.md` current product model.
Scope: repository history and this review; no application, workflow, deployed
resource, database, or training-data changes. UI states are unchanged.

## Proven duplicates

Reviewed against main `ef1b50ab1201b370c3ed53c12427ca94a32cf974`. The following 12 branch
tips can be retained as merge parents without applying their old file contents.
Ten trees are byte-for-byte identical to historical main trees. The sync overlay
implementation has the same stable patch ID as `cf52fb8` in main. Its separate
rule file is byte-for-byte equal to `b9886f9`; the file-map and knowledge additions
are present there, with the file map additionally listing the overlay E2E test.

This history-only merge makes each exact recorded tip an ancestor of main before
branch deletion. It preserves authors, dates, messages and original snapshots.
The first-parent application tree stays current; only these repository documents
change. It does not assert that every historical implementation remains current.

| Branch | Recorded tip | Evidence in pre-review main |
| --- | --- | --- |
| `cursor/cal-day-hover-chrome-8a23` | `48ee0593a5b342909b321dccf7cb764e74dbd53d` | Entire tree equals main ancestor `8821c7951a54c293a7e8b08e818a0dccbd36458d` |
| `cursor/cal-theme-shared-8a23` | `b48d86c13f7e5f877516ac127849896f9b2c0167` | Entire tree equals main ancestor `fe44c4caf64fcb6557aa2d79869360489174a1b6` |
| `cursor/drop-reset-plan-8a23` | `15f8336ec56f9c9f5b8aa6a1e5523e3df19cf111` | Entire tree equals main ancestor `8821c7951a54c293a7e8b08e818a0dccbd36458d` |
| `cursor/session-console-dialog-8a23` | `6a85bf33d0249a4ca3bf850237a5c5de96dca3ad` | Entire tree equals main ancestor `d8cbd66fb88c5345d3157c276068111d11cee088` |
| `cursor/session-console-grid-header-8a23` | `cbdeb29ceee5cffb1a991dc63fbae611e77b5985` | Entire tree equals main ancestor `b72a48e0ca1d04cc631a1a5f9d09b4b41d72a3a8` |
| `cursor/session-console-hover-filter-8a23` | `a75ba65134aa2001e640caf90df9033b918f493b` | Entire tree equals main ancestor `ded85c3324446ae006a9c12bf78473fc39a9d521` |
| `cursor/session-console-scope-8a23` | `0b84f96781a70479956c7db60525df5c85e694ad` | Entire tree equals main ancestor `fe44c4caf64fcb6557aa2d79869360489174a1b6` |
| `cursor/session-day-name-rule-9f4a` | `38cac7d4fb2f36a1b1685cca41970be3814a3170` | Entire tree equals main ancestor `2ff51d9c5ceda73a6b23537734ffc7561802e883` |
| `cursor/set-pct-adj-column-9f4a` | `ecebf3dbf21cbf51ea69201bd4fd7d2500fb9199` | Entire tree equals main ancestor `93aadb08c2cf5e272a40ad6068add7594b9cf9a8` |
| `cursor/shared-athlete-plans-7468` | `5a2a2e056392813cbb29266092ae80f9c9b6c627` | Entire tree equals main ancestor `e7be8d3eb0d26be34943ac10d7ac26fbc4009be9` |
| `cursor/sync-queue-overlay-9f4a` | `8d53e4107702f0a897dc6ea2033bafb58d7b207a` | Overlay implementation patch matches `cf52fb8`; rule matches `b9886f9` with an extended file map |
| `cursor/sync-queue-overlay-rule-9f4a` | `d7b29a0c3ee00ba3c5094da6b8e333f873d7226b` | Overlay implementation patch matches `cf52fb8`; rule matches `b9886f9` with an extended file map |

PRs #18, #20 and #23 are superseded. PR #30 is reused for the documented history
preservation, with its title and description rewritten to match the final change.
No open PR depends on the 12 branches after those actions.

## Eight branches retained for separate decisions

These branches do not have an identical historical main tree. Their exact tips
remain available; none is approved for automatic merge or deletion by this review.

| Branch | Distinct work / decision |
| --- | --- |
| `coach-planner-design` | Old dashboard proposal, share/audio experiments and backend changes bundled with a database snapshot, compiled files and a Windows Node distribution. Review useful ideas individually; do not import the bundle. |
| `cursor/calendar-sheet-surface-9f4a` | Separate month calendar, grid and inspector under `src/surface`, plus accessibility/Workspace parity work. Current main uses a different component path. Review the interaction and accessibility fixes individually. |
| `cursor/nav-insights-consolidation-9f4a` | Squash of the calendar/sheet prototype (#8); overlaps the preceding branch but is not established as equivalent to current main. Keep until that prototype review is complete. |
| `cursor/set-editor-main-surface-9f4a` | Extends the calendar/sheet prototype with a full-width editor and Name-menu fixes; PR #9 remains open on its existing base. Review together with that prototype. |
| `cursor/maximized-microcycle-editor-7468` | 58 separate commits spanning week-board UI, imported athlete plans, math and authorization. Some features now have replacements, but a commit-level review is still needed. PR #3 remains open. |
| `cursor/setup-cloud-env-c238` | Session/exercise builder plus a reusable owner-scoped custom movement library. The current Add Lift flow supports custom names, but this does not prove reusable per-owner library parity. PR #1 remains open; port useful behavior to the active backend if selected. |
| `cursor/zahar-athlete-profile-7866` | Historical single-athlete fixture and auto-seed changes. Auto-seeding conflicts with the current empty-plan policy. Preserve as historical data; a future explicit import must be separately designed. |
| `feature/exercise-card-refactor` | Extracted set row/navigation hooks, set dragging and card styling, mixed with old prototypes and generated artifacts. Review small useful patches against the current worksheet before porting. |

## Verification and cleanup conditions

- Check exact tree equality using Git tree object IDs across all main ancestors.
- Check stable patch equivalence for `8d53e41` and `cf52fb8`, equal rule blobs,
  and inspect the rule's remaining additions.
- Recheck live branch tips before moving/deleting refs; never force-push.
- Verify the final application tree differs only in the two repository documents.
- Verify all 12 retired tips are ancestors of final main before deletion.
- Verify the eight retained tips and three retained open PRs remain unchanged.
- Run normal hosted repository validation for the preservation PR.

This is a source-history checkpoint. No staging E2E, restore drill, provider gate,
backup schedule, production migration, or deployment is activated.
