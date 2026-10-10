import copy
from pathlib import Path
import shutil
import tempfile
import unittest

from codex_routing import ROOT, TIERS, select, select_lead, validate_config, validate_selection
from verify_codex_routing_runtime import validate_role_metadata

CATALOG = [{"slug": name, "supported_reasoning_levels": [{"effort": e} for e in ("low", "medium", "high")]} for name in ("gpt-6-luna", "gpt-6.1-sol", "gpt-6-sol")]


class RoutingTests(unittest.TestCase):
    def test_actual_role_metadata_required(self):
        rows = [{"agent_role": role, "model": model, "reasoning_effort": effort} for role, model, effort in ((None, "gpt-6.1-sol", "low"), ("architect", "gpt-6-luna", "low"), ("engineer", "gpt-6-luna", "medium"), ("verifier", "gpt-6.1-sol", "medium"))]
        validate_role_metadata(rows)
        with self.assertRaises(RuntimeError):
            validate_role_metadata(rows[:-1])
        rows[1]["reasoning_effort"] = "xhigh"
        with self.assertRaises(RuntimeError):
            validate_role_metadata(rows)

    def test_lead_default_and_fallback(self):
        self.assertEqual(select_lead(CATALOG)["model"], "gpt-6.1-sol")
        fallback = select_lead([m for m in CATALOG if m["slug"] != "gpt-6.1-sol"])
        self.assertEqual(fallback, {"model": "gpt-6-sol", "reasoning_effort": "low", "fallback": True})
        with self.assertRaises(ValueError):
            select_lead([])

    def test_all_tiers(self):
        for tier, expected in TIERS.items():
            result = select(tier, CATALOG)
            self.assertEqual((result["model"], result["reasoning_effort"]), expected)
            self.assertFalse(result["fallback"])

    def test_sol_fallback_keeps_effort(self):
        for tier in (4, 5):
            result = select(tier, [m for m in CATALOG if m["slug"] != "gpt-6.1-sol"])
            self.assertEqual(result["model"], "gpt-6-sol")
            self.assertEqual(result["reasoning_effort"], TIERS[tier][1])
            self.assertTrue(result["fallback"])

    def test_missing_model_fails_closed(self):
        for tier in TIERS:
            with self.assertRaises(ValueError):
                select(tier, [])

    def test_forbidden_efforts(self):
        for effort in ("xhigh", "max", "ultra", "Extra High", "extra_high", None):
            with self.assertRaises(ValueError):
                validate_selection("gpt-6.1-sol", effort)

    def test_astra_and_unapproved_models(self):
        for model in ("gpt-6-astra", "gpt-5.6-sol", "auto", None):
            with self.assertRaises(ValueError):
                validate_selection(model, "low")

    def test_unsupported_effort_not_silently_changed(self):
        catalog = copy.deepcopy(CATALOG)
        catalog[0]["supported_reasoning_levels"] = [{"effort": "low"}]
        with self.assertRaises(ValueError):
            select(3, catalog)

    def test_actual_project_configuration(self):
        validate_config()

    def mutated_config(self, change):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / ".codex", root / ".codex")
            change(root)
            with self.assertRaises(ValueError):
                validate_config(root)

    def test_role_cannot_pin_model_or_effort(self):
        for setting in ('model = "gpt-6-luna"', 'model_reasoning_effort = "low"'):
            self.mutated_config(lambda root: (root / ".codex/agents/engineer.toml").write_text(setting + '\nname="engineer"', encoding="utf-8"))

    def test_profiles_cannot_bypass_limits(self):
        self.mutated_config(lambda root: (root / ".codex/unsafe.config.toml").write_text('[profiles.retry]\nmodel_reasoning_effort="ultra"', encoding="utf-8"))

    def test_concurrency_limit(self):
        def change(root):
            path = root / ".codex/config.toml"
            path.write_text(path.read_text().replace('= 3', '= 4'), encoding="utf-8")
        self.mutated_config(change)


if __name__ == "__main__":
    unittest.main()
