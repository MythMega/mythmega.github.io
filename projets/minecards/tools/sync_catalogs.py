#!/usr/bin/env python3
"""sync_catalogs.py - Creates the per-set catalogue files the game expects.

Reference: `settings/cardsets.json` (the declared sets), `settings/config.json` (the four
directories), `js/business/TitleManager.js`, `js/business/PromoManager.js`,
`js/business/TrophyManager.js` and `js/business/ProfileIconManager.js` (one file per declared set).

WHY THIS SCRIPT
  The game asks for four catalogues per extension: its titles, its collection trophies, the
  profile icons those trophies unlock and, for every set declared `"promo": true`, its promo
  cards. A set added to `settings/cardsets.json` before those files are written therefore answers
  404: the game survives it (an extension may legitimately grant nothing), but the console fills
  with warnings and the deployment ships with holes. MineCards is a STATIC site - a browser cannot
  create a file - so the files are created here, at authoring time, and committed like any other
  catalogue.

WHAT IS CREATED
  - `<titles.directory>/<setId>.json`: its `Booster` name and an EMPTY `CollectionTitle` list.
  - `<trophies.directory>/<setId>.json`: its `Booster` name and an EMPTY `TrophyList`.
  - `<profileIcons.directory>/<setId>.json`: its `Booster` name and an EMPTY
    `CollectionTrophy` list.
  - `<promos.directory>/<setId>.json` for every set declared `"promo": true`: its `Serie` label
    and an EMPTY `Card` list, so the series exists as a catalogue before its first promo card is
    written. A set declared `"promo": false` gets nothing: the game never reads its promo file,
    and the lint reports a promo file of a set that does not declare one.
  An existing file is NEVER touched, whatever it holds: this script only fills the gaps, so it can
  run after a set is added without any risk of erasing a catalogue already being written.

USAGE
  python tools/sync_catalogs.py             create every missing catalogue file
  python tools/sync_catalogs.py --dry-run   print what would be created, change nothing
  python tools/sync_catalogs.py --check     exit 1 when a catalogue file is missing (CI)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

#: Directory of the project (the parent of `tools/`), so the script works from any cwd.
PROJECT_ROOT = Path(__file__).resolve().parent.parent

#: Catalogue of the declared sets, relative to the project root.
CARDSETS_PATH = "settings/cardsets.json"

#: Configuration holding the four directories, relative to the project root.
CONFIG_PATH = "settings/config.json"

#: Defaults, matching the `DEFAULT_*_SETTINGS` objects of `js/utils/ConfigLoader.js`.
DEFAULTS = {
    "titles": "data/titles",
    "trophies": "data/trophies",
    "profileIcons": "data/profile_icons",
    "promos": "data/promo_cards",
}

#: A set id is used as a file name: same rule as the `data/sets` lint rule.
SET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def read_json(relative_path: str):
    """Reads one JSON file of the project.

    Args:
        relative_path: Path of the file, relative to the project root.

    Returns:
        The parsed payload.

    Raises:
        SystemExit: When the file is missing, unreadable or not valid JSON.
    """
    path = PROJECT_ROOT / relative_path
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        raise SystemExit(f"{relative_path}: file not found") from None
    except OSError as error:
        raise SystemExit(f"{relative_path}: {error}") from None
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise SystemExit(f"{relative_path}: not valid JSON ({error})") from None


def read_directory(section: str) -> str:
    """Reads a `directory` value of `settings/config.json`, with its default.

    Args:
        section: Section of the configuration holding the value (`titles`, `trophies`,
            `profileIcons`, `promos`).

    Returns:
        The directory, without a leading `./` nor a trailing slash.
    """
    config = read_json(CONFIG_PATH)
    root = config.get(section) if isinstance(config, dict) else None
    value = root.get("directory") if isinstance(root, dict) else None
    if isinstance(value, str) and value.strip() != "":
        return value.strip().lstrip("./").rstrip("/")
    return DEFAULTS[section]


def declared_sets() -> list[dict]:
    """Lists the sets declared by `settings/cardsets.json`, in file order.

    Returns:
        One `{"id": str, "promo": bool}` entry per declared set, duplicates dropped.

    Raises:
        SystemExit: When the catalogue is unreadable or declares no `sets` array.
    """
    catalogue = read_json(CARDSETS_PATH)
    declared = catalogue.get("sets") if isinstance(catalogue, dict) else None
    if not isinstance(declared, list):
        raise SystemExit(f'{CARDSETS_PATH}: no "sets" array')

    sets = []
    seen = set()
    for entry in declared:
        raw = entry.get("id") if isinstance(entry, dict) else None
        set_id = raw.strip() if isinstance(raw, str) else ""
        if set_id == "" or set_id in seen:
            continue
        if not SET_ID_PATTERN.match(set_id):
            print(f"{CARDSETS_PATH}: set id {set_id!r} is not a file name, skipped", file=sys.stderr)
            continue
        seen.add(set_id)
        sets.append({"id": set_id, "promo": entry.get("promo") is True})
    return sets


def payloads(set_id: str) -> dict:
    """Builds the payload of one catalogue file per kind, each declaring nothing yet.

    Args:
        set_id: Identifier of the extension.

    Returns:
        `{"kind": {payload, indent or None}}`, the indentation matching the shipped catalogues
        (`None` for a file the game does not expect, i.e. the promo of a set without promos).
    """
    return {
        "titles": ({"Booster": set_id, "CollectionTitle": []}, 4),
        "trophies": ({"Booster": set_id, "TrophyList": []}, 4),
        "profileIcons": ({"Booster": set_id, "CollectionTrophy": []}, 4),
        # A declared series always ships its promo file, even before its first promo card: an
        # empty catalogue is "no promo card yet", which is not an error (see `PromoManager`).
        "promos": ({"Serie": f"Promo {set_id}", "Name": f"Promo {set_id}", "Card": []}, 2),
    }


def wanted_files(sets: list[dict]) -> list[dict]:
    """Lists the catalogue files the game expects, with the content of a missing one.

    Args:
        sets: The declared sets (`declared_sets()`).

    Returns:
        One `{"path": str, "payload": dict, "indent": int}` entry per expected file.
    """
    directories = {kind: read_directory(kind) for kind in DEFAULTS}
    expected = []
    for entry in sets:
        set_id = entry["id"]
        for kind, (payload, indent) in payloads(set_id).items():
            if kind == "promos" and not entry["promo"]:
                continue
            expected.append(
                {
                    "path": f"{directories[kind]}/{set_id}.json",
                    "payload": payload,
                    "indent": indent,
                }
            )
    return expected


def serialize(payload: dict, indent: int) -> bytes:
    """Renders a catalogue file the way the repository stores it (CRLF, trailing newline).

    Args:
        payload: The content of the file.
        indent: Indentation width.

    Returns:
        The UTF-8 bytes to write.
    """
    text = json.dumps(payload, indent=indent, ensure_ascii=False).replace("\n", "\r\n")
    return (text + "\r\n").encode("utf-8")


def main() -> int:
    """Creates the missing catalogue files.

    Returns:
        The process exit status: 1 in `--check` mode when a file is missing, 0 otherwise.
    """
    parser = argparse.ArgumentParser(
        description="Create the titles, trophies, icons and promo files a declared set expects.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="change nothing and exit 1 when a catalogue file is missing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would be created, change nothing",
    )
    arguments = parser.parse_args()

    expected = wanted_files(declared_sets())
    missing = [entry for entry in expected if not (PROJECT_ROOT / entry["path"]).exists()]

    for entry in missing:
        relative_path = entry["path"]
        if arguments.check:
            print(f"missing {relative_path}")
            continue
        if arguments.dry_run:
            print(f"would create {relative_path}")
            continue
        path = PROJECT_ROOT / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(serialize(entry["payload"], entry["indent"]))
        print(f"created {relative_path}")

    if not missing:
        print(f"Every catalogue exists ({len(expected)} file(s) checked).")
        return 0

    if arguments.check:
        print(f"{len(missing)} of {len(expected)} catalogue file(s) missing.", file=sys.stderr)
        return 1

    created = 0 if arguments.dry_run else len(missing)
    print(f"{len(missing)} file(s) missing, {created} created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
