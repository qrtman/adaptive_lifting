"""Read native CLI config/catalog and local validation thread metadata; no remote writes."""
import argparse
import json
from pathlib import Path
import queue
import sqlite3
import subprocess
import threading

from codex_routing import ROOT, select, validate_config


def native_config():
    process = subprocess.Popen(["codex", "app-server", "--strict-config", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
    messages = queue.Queue()
    def read():
        for line in process.stdout:
            messages.put(json.loads(line))
    threading.Thread(target=read, daemon=True).start()
    def send(method, params, identifier=None):
        message = {"method": method, "params": params}
        if identifier is not None:
            message["id"] = identifier
        process.stdin.write(json.dumps(message) + "\n")
        process.stdin.flush()
        if identifier is not None:
            while True:
                response = messages.get(timeout=30)
                if response.get("id") == identifier:
                    if "error" in response:
                        raise RuntimeError(response["error"])
                    return response["result"]
    try:
        send("initialize", {"clientInfo": {"name": "adaptive-routing-verifier", "version": "1"}, "capabilities": {"experimentalApi": True}}, 1)
        send("initialized", {})
        data = send("config/read", {"cwd": str(ROOT), "includeLayers": False}, 2)["config"]
        agent_keys = ("enabled", "max_concurrent_threads_per_session", "default_subagent_model", "default_subagent_reasoning_effort")
        return {"model": data.get("model"), "model_reasoning_effort": data.get("model_reasoning_effort"), "agents": {key: data.get("agents", {}).get(key) for key in agent_keys}}
    finally:
        process.terminate()
        process.wait(timeout=10)


def recorded_spawns(state_path):
    # Read only specified validation agents; never inspect auth or secret stores.
    connection = sqlite3.connect(state_path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute("SELECT agent_path,model,reasoning_effort,tokens_used,cli_version FROM threads WHERE agent_path IN (?,?,?) ORDER BY created_at DESC", ("/root/routing_search", "/root/routing_analysis", "/root/routing_complex")).fetchall()
        return [dict(row) for row in rows]
    finally:
        connection.close()


ROLE_PROMPT = """Read-only native custom-role validation. Explicitly spawn exactly three subagents with forked context disabled: architect with model gpt-6-luna and reasoning low; engineer with model gpt-6-luna and reasoning medium; verifier with model gpt-6.1-sol and reasoning medium. Use the exact native custom agent types. Give each a small independent reasoning task: architect state one benefit of unique file ownership; engineer analyze why replay retries need retained mutation IDs; verifier analyze why a CLI dry run is not proof of SQL success. No shell, browser, connectors, secrets, remote services, repository writes, or further delegation. Wait for all three; return PASS only if native spawn succeeded. If the roles or overrides are unavailable report that limitation without falling back silently."""


def validate_role_metadata(rows):
    expected = {None: ("gpt-6.1-sol", "low"), "architect": ("gpt-6-luna", "low"), "engineer": ("gpt-6-luna", "medium"), "verifier": ("gpt-6.1-sol", "medium")}
    if len(rows) != 4:
        raise RuntimeError("Native role probe must record exactly one Lead and three subagents")
    for role, pair in expected.items():
        matching = [row for row in rows if row["agent_role"] == role]
        if len(matching) != 1 or (matching[0]["model"], matching[0]["reasoning_effort"]) != pair:
            raise RuntimeError(f"Actual native role override not verified: {role}")


def role_evidence(state_path, events_path):
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
    started = [event for event in events if event["type"] == "thread.started"]
    completed = [event for event in events if event["type"] == "turn.completed"]
    if len(started) != 1 or len(completed) != 1 or any(event["type"] in ("error", "turn.failed") for event in events):
        raise RuntimeError("Native probe did not complete one successful turn")
    identifier = started[0]["thread_id"]
    connection = sqlite3.connect(state_path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in connection.execute("SELECT agent_role,model,reasoning_effort,tokens_used,cli_version FROM threads WHERE id=? OR source LIKE ?", (identifier, "%" + identifier + "%")).fetchall()]
    finally:
        connection.close()
    validate_role_metadata(rows)
    return {"actual_role_sessions": rows, "lead_turn_usage": completed[0].get("usage"), "outcome": "PASS"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-db", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--native-events", type=Path, required=True)
    parser.add_argument("--run-role-probe", action="store_true", help="Consumes model tokens; saves native CLI events outside the repository")
    args = parser.parse_args()
    expected = validate_config()
    effective = native_config()
    if effective != {k: expected[k] for k in effective}:
        raise RuntimeError("Effective native configuration differs; project trust or user overrides need inspection")
    catalog = json.loads(subprocess.check_output(["codex", "debug", "models"], text=True, encoding="utf-8"))
    models = catalog if isinstance(catalog, list) else catalog["models"]
    selections = {str(tier): select(tier, models) for tier in range(1, 6)}
    if args.run_role_probe:
        if args.native_events.resolve().is_relative_to(ROOT) or args.native_events.exists():
            raise RuntimeError("Use a new native probe events file outside the repository")
        with args.native_events.open("w", encoding="utf-8") as output:
            subprocess.run(["codex", "exec", "--strict-config", "--json", "--sandbox", "read-only", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="low"', ROLE_PROMPT], cwd=ROOT, stdout=output, check=True, timeout=300)
    roles = role_evidence(args.state_db, args.native_events)
    spawns = recorded_spawns(args.state_db)
    expected_spawns = {"/root/routing_search": ("gpt-6-luna", "low"), "/root/routing_analysis": ("gpt-6-luna", "medium"), "/root/routing_complex": ("gpt-6.1-sol", "medium")}
    for name, pair in expected_spawns.items():
        matching = [row for row in spawns if row["agent_path"] == name]
        if len(matching) != 1 or (matching[0]["model"], matching[0]["reasoning_effort"]) != pair:
            raise RuntimeError(f"Actual spawn settings not verified: {name}")
    evidence = {"cli_version": subprocess.check_output(["codex", "--version"], text=True).strip(), "effective_native_config": effective, "tier_selections": selections, "actual_spawns": spawns, "native_custom_role_probe": roles, "credit_usage": "unavailable", "remote_changes": "none"}
    args.evidence.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("Native configuration, catalog and actual spawn metadata PASS")
