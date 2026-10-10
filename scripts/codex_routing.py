"""Offline validation and selection for native Codex routing; not a routing service."""
import argparse
import json
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"gpt-6-luna", "gpt-6.1-sol", "gpt-6-sol"}
EFFORTS = {"low", "medium", "high"}
TIERS = {
    1: ("gpt-6-luna", "low"),
    2: ("gpt-6-luna", "low"),
    3: ("gpt-6-luna", "medium"),
    4: ("gpt-6.1-sol", "medium"),
    5: ("gpt-6.1-sol", "high"),
}


def validate_selection(model, effort):
    if model not in MODELS or effort not in EFFORTS:
        raise ValueError("Routing requires an approved model and low/medium/high effort")


def select(tier, catalog):
    model, effort = TIERS[tier]
    by_name = {m.get("slug", m.get("model")): m for m in catalog}
    fallback = model == "gpt-6.1-sol" and model not in by_name
    if fallback:
        model = "gpt-6-sol"
    validate_selection(model, effort)
    if model not in by_name:
        raise ValueError("Required model unavailable; no automatic alternative allowed")
    levels = by_name[model].get("supported_reasoning_levels", [])
    if effort not in {v["effort"] for v in levels}:
        raise ValueError("Selected effort unsupported; do not silently change it")
    return {"model": model, "reasoning_effort": effort, "fallback": fallback}


def select_lead(catalog):
    names = {m.get("slug", m.get("model")) for m in catalog}
    model = "gpt-6.1-sol" if "gpt-6.1-sol" in names else "gpt-6-sol"
    entry = next((m for m in catalog if m.get("slug", m.get("model")) == model), None)
    if entry is None or "low" not in {v["effort"] for v in entry.get("supported_reasoning_levels", [])}:
        raise ValueError("Approved Lead model/low effort unavailable")
    return {"model": model, "reasoning_effort": "low", "fallback": model == "gpt-6-sol"}


def validate_config(root=ROOT):
    config = tomllib.loads((root / ".codex/config.toml").read_text(encoding="utf-8"))
    validate_selection(config["model"], config["model_reasoning_effort"])
    if (config["model"], config["model_reasoning_effort"]) != ("gpt-6.1-sol", "low"):
        raise ValueError("Lead defaults differ from policy")
    agents = config["agents"]
    if not agents["enabled"] or agents["max_concurrent_threads_per_session"] != 3:
        raise ValueError("Native subagent limit must be three")
    if (agents["default_subagent_model"], agents["default_subagent_reasoning_effort"]) != TIERS[1]:
        raise ValueError("Subagent defaults differ from policy")
    for path in (root / ".codex").rglob("*.toml"):
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        def walk(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in ("model", "default_subagent_model") and item not in MODELS:
                        raise ValueError(f"Unapproved model in {path.name}")
                    if key in ("model_reasoning_effort", "default_subagent_reasoning_effort") and item not in EFFORTS:
                        raise ValueError(f"Forbidden effort in {path.name}")
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
        walk(data)
        if path.parent.name == "agents":
            if any(k in data for k in ("model", "model_reasoning_effort")):
                raise ValueError("Custom roles must not override per-task model/effort")
            if not all(isinstance(data.get(k), str) and data[k].strip() for k in ("name", "description", "developer_instructions")):
                raise ValueError("Custom role is missing required native fields")
    if {p.stem for p in (root / ".codex/agents").glob("*.toml")} != {"architect", "engineer", "verifier"}:
        raise ValueError("Exactly the three reviewed custom role files are required")
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tier", type=int, choices=TIERS)
    parser.add_argument("--lead", action="store_true")
    parser.add_argument("--catalog", type=Path)
    args = parser.parse_args()
    validate_config()
    if args.tier or args.lead:
        if args.tier and args.lead:
            parser.error("choose --tier or --lead")
        if not args.catalog:
            parser.error("selection requires an actual --catalog from codex debug models")
        data = json.loads(args.catalog.read_text(encoding="utf-8-sig"))
        catalog = data if isinstance(data, list) else data["models"]
        print(json.dumps(select_lead(catalog) if args.lead else select(args.tier, catalog)))
    else:
        print("Routing configuration PASS")
