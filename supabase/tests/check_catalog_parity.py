"""Compare the checked-in Edge payload with the frozen Python catalog behavior."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.analytics_registry import PRESET_CARDS, catalog_metrics
from backend.analytics_schemas import CatalogPayload
from backend.exercise_patterns import PATTERNS

actual = CatalogPayload(
    metrics=catalog_metrics(),
    patterns=list(PATTERNS),
    visualizations=["line", "bar", "heatmap", "weekday_matrix", "table"],
    grains=["day", "week", "block"],
    aggregations=["sum", "mean", "max", "last"],
    presets=PRESET_CARDS,
).model_dump(mode="json")
fixture = json.loads((Path(__file__).parents[1] / "functions/api/catalog.json").read_text(encoding="utf-8"))
assert fixture == actual, "The Edge catalog diverged from the Python registry"
print("catalog parity: pass")
