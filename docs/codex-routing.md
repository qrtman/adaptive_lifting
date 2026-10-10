# Adaptive engineering routing

The Lead classifies each task using AGENTS.md section 6 before assigning it.
Use the lowest sufficient tier. Native `.codex/config.toml` selects Sol 6.1 low
for the Lead, Luna low for subagents, and a maximum of three concurrent subagents.
Architect, Engineer and Verifier files intentionally omit model and effort.
The Lead owns integration and overlapping file writes; delegate only bounded work
that benefits from a separate agent. Critical decisions receive independent review.

For each spawn, include scope, role, tier, exact model/effort, acceptance criteria,
file ownership, permitted tools, and a concise routing record. In this client, use
the native spawn overrides `model` and `reasoning_effort` with `fork_turns="none"`
when overriding the model. Supply all necessary context explicitly. Other native
clients may name the effort parameter differently; inspect their schema first.
Do not set model/effort in custom roles: those values override dynamic selections.

## Selection and validation

```powershell
python scripts/codex_routing.py
python scripts/test_codex_routing.py
# Save catalog outside the repository; PowerShell Out-File encoding varies by version.
codex debug models | Out-File -Encoding utf8 "$env:TEMP\adaptive-models.json"
python scripts/codex_routing.py --tier 3 --catalog "$env:TEMP\adaptive-models.json"
python scripts/codex_routing.py --lead --catalog "$env:TEMP\adaptive-models.json"
```

The selector fails when an allowed model or its exact effort is unavailable.
Only Sol 6.1 may fall back to Sol 6, retaining the requested effort. Native Codex
does not provide an availability fallback in this project config; the Lead must
apply the returned explicit override. For a fallback Lead invocation:
`codex -m gpt-6-sol -c 'model_reasoning_effort="low"'`.
Never switch models to address a missing credential, permission, tool or network.
Diagnose after the first failed reasoned attempt before escalating. Preserve that
attempt's usage and outcome in the same task record.

The validator scans all project TOML profiles and rejects forbidden efforts,
unapproved models, altered defaults and custom role model/effort pins. It is a local
check, not a service or mandatory spawn interception. CLI overrides, global profiles
and manual API calls remain outside that check. No supported native maximum-effort
lock was established; do not describe the ceiling as technically enforced everywhere.
The installed model catalog supports higher efforts which this policy prohibits.
Existing sessions are not reconfigured by changing the project defaults. This Lead
session's running model was not changed; the defaults govern newly configured sessions.

## Verified runtime evidence

Tested on Codex CLI 0.162.0 on 2026-10-11. Native app-server `config/read` with
strict config confirmed the project defaults and concurrency cap. `codex debug models`
confirmed all requested models support the selected efforts. Three real subagent
tasks completed using explicit overrides; a read-only query of native local thread
metadata confirmed the applied model and effort (not agent self-report).

| Agent | Tier / assignment | Actual model / effort | Reason | Escalation | Outcome |
| --- | --- | --- | --- | --- | --- |
| routing_search | 1 / locate bootstrap and count migrations | Luna / low | Bounded file search | None | PASS |
| routing_analysis | 3 / trace CLI error handling and project guards | Luna / medium | Two-file control-flow analysis | None | PASS |
| routing_complex | 4 / analyze partial bootstrap recovery | Sol 6.1 / medium | Multiple validation boundaries and recovery interactions | None | PASS |
| Native CLI Lead | Orchestrate explicit role probe | Sol 6.1 / low | Three bounded assignments | None | PASS |
| Native architect | 1 / explain file ownership | Luna / low | Single clear invariant | None | PASS |
| Native engineer | 3 / analyze retry identity | Luna / medium | Idempotency reasoning | None | PASS |
| Native verifier | 4 / analyze dry-run limitations | Sol 6.1 / medium | Distinguish planning from transaction execution | None | PASS |

All tasks were read-only local inspections. Search confirmed the canonical baseline
and 63 migrations. Moderate analysis traced native stderr/exit handling and exact
target isolation. Complex analysis identified the documented recovery limitation:
dry-run does not execute SQL, and partial committed bootstrap needs a forward fix.
No forbidden effort or Astra was selected. Fallback behavior is unit-tested;
the fallback model was available in the catalog but was not live-spawn tested.

`codex-routing-evidence.json` preserves the observed native metadata, including
raw `tokens_used` values. These are runtime cumulative counters, not billed tokens
or credit charges. They include agent context/tool work; do not translate them into
dollars. Credit usage and per-request billing breakdown were unavailable. For these
successful tasks, no model retries occurred; account for the associated
verification work as part of this routing validation task, whose full billed cost
is unavailable. The role probe additionally records its native Lead turn usage:
142,106 input tokens (117,120 cached), 490 output tokens. Its child raw counters
are recorded separately, so do not treat Lead usage as inclusive of all children.
Do not claim a measured cost advantage from this small sample.

The native custom-role probe used `codex exec --strict-config --json` in a read-only
sandbox, with Sol 6.1 low for the Lead. It explicitly spawned Architect Luna low,
Engineer Luna medium and Verifier Sol 6.1 medium; native metadata verified both
role identity and applied model/effort. No role-level pins overrode those selections.
The first config-comparison attempt encountered extra native default/null fields;
inspection corrected the comparison to configured keys. Native `debug` does not
support `--strict-config`; strict parsing was verified through app-server and exec.
These local validation corrections did not trigger model escalation or task retries.

The runtime evidence collector is specific to these three named validation spawns:

```powershell
python scripts/verify_codex_routing_runtime.py --state-db "$env:USERPROFILE\.codex\state_5.sqlite" --native-events "$env:TEMP\adaptive-native-role-validation.jsonl" --evidence docs/codex-routing-evidence.json
git diff --check
```

It reads only their model, effort and usage fields, not credentials. Local database
layout is version-specific; missing fields or ambiguous duplicate validation names
fail rather than infer success. For another run, spawn fresh tasks with these names
in an isolated session/state store or update the exact selectors after inspecting
the installed runtime. Add `--run-role-probe` with a new external events path to
execute the native role probe again (it consumes model usage). The collector also
requires the three named repository-validation spawns; it fails if they are absent.
Never access production/staging services for routing tests.

Official behavior: [subagent settings and precedence](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[native configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Project configuration requires a trusted project; effective config verification
detects an ignored project layer or overriding user settings. This task did not
change global configuration, project trust, security policy or production authorization.
