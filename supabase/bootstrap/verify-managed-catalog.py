"""Compare a read-only managed-project catalog snapshot with the validated schema.

Input is the JSON output from catalog.sql, never application rows. The only
intentional difference from the retained staging catalog is migration 63's
three positive server-revision columns/constraints.
"""
import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_schema import validate_revision_delta  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path, help="JSON output captured from catalog.sql")
    args = parser.parse_args()
    try:
        actual = json.loads(args.catalog.read_text(encoding="utf-8-sig"))
        expected = json.loads((HERE / "staging-catalog.json").read_text(encoding="utf-8"))["catalog"]
        validate_revision_delta(expected, actual)
    except Exception as error:
        raise SystemExit(f"Managed catalog comparison FAIL: {error}") from error
    print("Managed application catalog PASS: exact 62-migration baseline plus only migration 63 revision delta.")


if __name__ == "__main__":
    main()
