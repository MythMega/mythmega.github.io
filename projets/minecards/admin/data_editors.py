#!/usr/bin/env python3
"""data_editors.py - the local server behind `admin/data_editors.html`.

WHY THIS EXISTS
The game data lives in hand-written JSON files that the linter checks (`tools/lint.mjs`,
`data/*` rules). Editing them by hand means remembering every cross-reference: a pinned offer
names a card index that must exist, a trophy names a card of the right printing, an Illager trade
rewards a currency the currencies file declares. This program serves a page that edits those files
two ways - a form generated from the shape of the data, and the raw JSON with completion and
search - and it NEVER writes a file the linter would reject.

HOW A SAVE WORKS
  1. the candidate text is parsed as JSON (a syntax error never reaches the disk);
  2. `node tools/lint.mjs --json --only data/` runs with the candidate passed through the
     `LINT_OVERLAY_FILE` overlay of `tools/lint/lib/repo.mjs`: every rule reads the candidate
     instead of the file, so a validation NEVER touches the real file. Only the diagnostics that
     name THIS file (plus any rule that could not run at all) are considered;
  3. a save writes the bytes only once the linter accepted them; a refused save writes nothing and
     the page shows the diagnostics with their line.
The page validates when a file is opened, on "Vérifier" and on "Enregistrer": no keystroke costs
an expensive lint run, and an abandoned edit never leaves a half-written file behind.

SECURITY
The server binds to the loopback interface only, refuses a non-loopback `Host` (DNS rebinding) and
serves the project directory read-only apart from the `/api/save` route, which only accepts the
files it lists itself. There is no password: the boundary is "running on this machine". Do not
expose it on a network interface.

USAGE
    python admin/data_editors.py                 # http://127.0.0.1:8770/
    python admin/data_editors.py --port 9000
    python admin/data_editors.py --no-browser    # when the browser is opened by hand
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_PORT = 8770

#: The page this server hosts, relative to the project root.
PAGE_PATH = "/admin/data_editors.html"

#: How long one lint run may take before the request is refused.
LINT_TIMEOUT_SECONDS = 180

#: Every file family the page can edit. `per_set` files get their set id from their name.
FILE_GROUPS = (
    {"glob": "data/shop/pinned_offers.json", "kind": "pinned_offers", "per_set": False},
    {"glob": "data/illager_shop/illager_currencies.json", "kind": "illager_currencies", "per_set": False},
    {"glob": "data/illager_shop/illager_shop.json", "kind": "illager_shop", "per_set": False},
    {"glob": "data/titles/*.json", "kind": "titles", "per_set": True},
    {"glob": "data/trophies/*.json", "kind": "trophies", "per_set": True},
    {"glob": "data/profile_icons/*.json", "kind": "profile_icons", "per_set": True},
)

#: Human labels of the file families, in sidebar order.
KINDS = {
    "pinned_offers": {
        "label": "Boutique · offres épinglées",
        "description": "Les offres écrites à la main du marchand itinérant : carte vendue, prix en "
        "ressources, fenêtre de vente et stock.",
    },
    "illager_currencies": {
        "label": "Illager · monnaies et quêtes",
        "description": "Une monnaie temporaire par entrée, avec ses quêtes datées et leurs "
        "récompenses.",
    },
    "illager_shop": {
        "label": "Illager · offres",
        "description": "Les lots d'offres payés dans une monnaie Illager, et la récompense de "
        "chaque échange.",
    },
    "titles": {
        "label": "Titres",
        "description": "Les titres qu'un trophée de collection débloque, traduits langue par "
        "langue.",
    },
    "trophies": {
        "label": "Trophées",
        "description": "Les trophées de collection d'une extension : rareté, cartes exigées, "
        "expérience et icône.",
    },
    "profile_icons": {
        "label": "Icônes de profil",
        "description": "Les icônes de profil qu'un trophée de collection débloque.",
    },
}

#: File that owns the list of quest objectives (game, lint rule and this form read it).
QUEST_TYPES_PATH = "js/business/IllagerQuestTypes.js"


def read_quest_types():
    """Reads the quest objectives from the module the linter owns.

    The list used to be copied here, in the game and in `tools/lint/rules/data.mjs`; a type added
    to the game could then be rejected by the linter. `js/business/IllagerQuestTypes.js` is now the
    only copy, and this function extracts its values in declaration order.

    Returns:
        tuple[str, ...]: The objective names, or an empty tuple when the file cannot be read (the
        form then falls back to a free text field and the lint still refuses an unknown type).
    """
    try:
        text = (PROJECT_ROOT / QUEST_TYPES_PATH).read_text(encoding="utf-8")
    except OSError as error:
        print(f"data_editors: cannot read {QUEST_TYPES_PATH}: {error}", file=sys.stderr)
        return ()

    start = text.find("Object.freeze({")
    end = text.find("});", start + 1)
    block = text[start + len("Object.freeze({") : end] if start >= 0 and end > start else ""
    values = tuple(re.findall(r"^\s*[A-Z0-9_]+:\s*'([^']+)'", block, flags=re.MULTILINE))
    if not values:
        print(f"data_editors: no quest type found in {QUEST_TYPES_PATH}", file=sys.stderr)
    return values


#: Objectives an Illager quest can ask for.
QUEST_TYPES = read_quest_types()

#: Reward kinds the Illager Shop understands (`ILLAGER_REWARD_TYPES` of the lint rule).
ILLAGER_REWARD_TYPES = ("Sparks", "Ultima", "Card", "Booster")

#: Trophy rarities (`TROPHY_RARITIES` of the lint rule).
TROPHY_RARITIES = ("bronze", "silver", "gold", "diamond", "emerald")

#: Printings a trophy requirement can ask for (`REQUIREMENT_LAYOUTS`).
REQUIREMENT_LAYOUTS = ("any", "classic", "fullart")


def field(key, kind, label, **extra):
    """Builds one field of a form schema.

    Args:
        key: Name of the JSON key.
        kind: Control type (`string`, `integer`, `date`, `enum`, `cardIndex`, ...).
        label: French label shown by the form.
        **extra: Control options (`choices`, `source`, `min`, `required`, `optional`, `help`,
            `nullable`, `titleKey`).

    Returns:
        dict: The field description sent to the page.
    """
    spec = {"key": key, "type": kind, "label": label}
    spec.update(extra)
    return spec


SCHEMAS = {
    "pinned_offers": {
        "label": KINDS["pinned_offers"]["label"],
        "root": {
            "type": "array",
            "item": {
                "type": "object",
                "titleKey": "OfferID",
                "fields": [
                    field("OfferID", "integer", "Identifiant de l'offre", min=1, required=True),
                    field("MaxUse", "integer", "Stock maximum", min=1, required=True),
                    field(
                        "Card",
                        "object",
                        "Carte vendue",
                        required=True,
                        fields=[
                            field("Index", "cardIndex", "Index de la carte", required=True),
                            field("isPromotional", "boolean", "Carte promotionnelle"),
                        ],
                    ),
                    field(
                        "Price",
                        "map",
                        "Prix (ressources)",
                        required=True,
                        valueType="integer",
                        source="resources",
                        help="Une entrée par ressource minière : le nom doit exister dans "
                        "shop.itemsValues de settings/config.json.",
                    ),
                    field(
                        "Period",
                        "object",
                        "Période de vente",
                        optional=True,
                        fields=[
                            field("Min", "date", "Du", required=True),
                            field("Max", "date", "Au", required=True),
                        ],
                    ),
                ],
            },
        },
    },
    "illager_currencies": {
        "label": KINDS["illager_currencies"]["label"],
        "root": {
            "type": "array",
            "item": {
                "type": "object",
                "titleKey": "Name",
                "fields": [
                    field("ID", "string", "Identifiant de la monnaie", required=True),
                    field("_comment", "string", "Commentaire", optional=True),
                    field("Name", "string", "Nom affiché", required=True),
                    field("ExpirationDate", "date", "Expiration", required=True),
                    field(
                        "Texture",
                        "asset",
                        "Texture",
                        required=True,
                        help="Un chemin sous assets/.",
                    ),
                    field(
                        "ConversionRate",
                        "integer",
                        "Taux de conversion en Sparks",
                        min=1,
                        required=True,
                    ),
                    field(
                        "Quests",
                        "array",
                        "Quêtes",
                        optional=True,
                        item={
                            "type": "object",
                            "titleKey": "ID",
                            "fields": [
                                field("ID", "string", "Identifiant de la quête", required=True),
                                field("StartDate", "date", "Début", required=True),
                                field("ExpirationDate", "date", "Fin", optional=True),
                                field("Type", "enum", "Objectif", choices=list(QUEST_TYPES), required=True),
                                field(
                                    "RequirementsToUnlock",
                                    "integer",
                                    "Objectif à atteindre",
                                    min=1,
                                    required=True,
                                ),
                                field("RewardCurrency", "integer", "Récompense en monnaie", min=0),
                                field("RewardSparks", "integer", "Récompense en Sparks", min=0),
                                field("RewardXP", "integer", "Récompense en XP", min=0),
                                field(
                                    "Label",
                                    "localized",
                                    "Libellé personnalisé",
                                    optional=True,
                                    help="Remplace la phrase du type de quête. Seules les "
                                    "langues déclarées dans settings/config.json sont lues.",
                                ),
                                field(
                                    "UrlButtonGo",
                                    "url",
                                    "URL du bouton",
                                    optional=True,
                                    help="Uniquement pour CustomWebsiteOpen, et seulement "
                                    "http(s).",
                                ),
                            ],
                        },
                    ),
                ],
            },
        },
    },
    "illager_shop": {
        "label": KINDS["illager_shop"]["label"],
        "root": {
            "type": "array",
            "item": {
                "type": "object",
                "titleKey": "SetName",
                "fields": [
                    field("ID", "integer", "Identifiant du lot", min=1, required=True),
                    field("SetName", "string", "Nom du lot", required=True),
                    field(
                        "Availabilities",
                        "object",
                        "Disponibilité",
                        required=True,
                        fields=[
                            field("Start", "date", "Début", required=True),
                            field("End", "date", "Fin", required=True),
                        ],
                    ),
                    field(
                        "CurrencyUsed",
                        "enum",
                        "Monnaie utilisée",
                        source="currencies",
                        required=True,
                    ),
                    field(
                        "TradeSet",
                        "array",
                        "Échanges",
                        required=True,
                        item={
                            "type": "object",
                            "titleKey": "Price",
                            "fields": [
                                field("Price", "integer", "Prix", min=1, required=True),
                                field("Repeatable", "boolean", "Répétable"),
                                field(
                                    "Rewards",
                                    "array",
                                    "Récompenses",
                                    required=True,
                                    item={
                                        "type": "object",
                                        "titleKey": "Type",
                                        "fields": [
                                            field(
                                                "Type",
                                                "enum",
                                                "Type",
                                                choices=list(ILLAGER_REWARD_TYPES),
                                                required=True,
                                            ),
                                            field("Qte", "integer", "Quantité", min=1, required=True),
                                            field(
                                                "Data",
                                                "cardKeyOrSet",
                                                "Carte ou extension",
                                                optional=True,
                                                help="Requis pour Card (<Index>_<layout>) et "
                                                "Booster (identifiant d'extension).",
                                            ),
                                        ],
                                    },
                                ),
                            ],
                        },
                    ),
                ],
            },
        },
    },
    "titles": {
        "label": KINDS["titles"]["label"],
        "root": {
            "type": "object",
            "fields": [
                field("Booster", "setId", "Extension", required=True),
                field(
                    "CollectionTitle",
                    "array",
                    "Titres de collection",
                    item={
                        "type": "object",
                        "titleKey": "CollectionTrophy",
                        "fields": [
                            field(
                                "CollectionTrophy",
                                "trophyName",
                                "Trophée de collection",
                                required=True,
                            ),
                            field(
                                "UnlockedTitle",
                                "array",
                                "Titres débloqués",
                                required=True,
                                item={
                                    "type": "object",
                                    "titleKey": "id",
                                    "fields": [
                                        field("id", "string", "Identifiant du titre", required=True),
                                        field("text", "localized", "Texte", required=True),
                                    ],
                                },
                            ),
                        ],
                    },
                ),
            ],
        },
    },
    "trophies": {
        "label": KINDS["trophies"]["label"],
        "root": {
            "type": "object",
            "fields": [
                field("Booster", "setId", "Extension", required=True),
                field(
                    "TrophyList",
                    "array",
                    "Trophées",
                    item={
                        "type": "object",
                        "titleKey": "Name",
                        "fields": [
                            field("_comment", "string", "Commentaire", optional=True),
                            field("Name", "string", "Nom", required=True),
                            field(
                                "Rarity",
                                "enum",
                                "Rareté",
                                choices=list(TROPHY_RARITIES),
                                required=True,
                            ),
                            field(
                                "MusthaveAllRequirementsCompleted",
                                "boolean",
                                "Toutes les exigences requises",
                            ),
                            field(
                                "Requirements",
                                "object",
                                "Exigences",
                                required=True,
                                fields=[
                                    field(
                                        "RequirementType",
                                        "enum",
                                        "Type d'exigence",
                                        choices=["CardList"],
                                    ),
                                    field(
                                        "Type",
                                        "enum",
                                        "Impression exigée",
                                        choices=list(REQUIREMENT_LAYOUTS),
                                    ),
                                    field(
                                        "Items",
                                        "array",
                                        "Cartes exigées",
                                        required=True,
                                        item={"type": "cardIndex"},
                                    ),
                                ],
                            ),
                            field(
                                "Experience",
                                "integer",
                                "Expérience",
                                min=0,
                                optional=True,
                                nullable=True,
                                help="Vide : l'expérience vient de la rareté, dans "
                                "settings/config.json.",
                            ),
                            field("Icon", "asset", "Icône", required=True),
                        ],
                    },
                ),
            ],
        },
    },
    "profile_icons": {
        "label": KINDS["profile_icons"]["label"],
        "root": {
            "type": "object",
            "fields": [
                field("Booster", "setId", "Extension", required=True),
                field(
                    "CollectionTrophy",
                    "array",
                    "Icônes de collection",
                    item={
                        "type": "object",
                        "titleKey": "CollectionTrophy",
                        "fields": [
                            field(
                                "CollectionTrophy",
                                "trophyName",
                                "Trophée de collection",
                                required=True,
                            ),
                            field(
                                "UnlockedIcon",
                                "array",
                                "Icônes débloquées",
                                required=True,
                                item={"type": "iconName"},
                            ),
                        ],
                    },
                ),
            ],
        },
    },
}


def read_json(rel_path, default=None):
    """Reads one project JSON file, never raising.

    Args:
        rel_path: Project-relative path.
        default: Value returned when the file is missing or invalid.

    Returns:
        The parsed value, or `default`.
    """
    try:
        with (PROJECT_ROOT / rel_path).open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return default


def json_files(rel_dir):
    """Lists the JSON files of a directory, sorted by name.

    Args:
        rel_dir: Project-relative directory.

    Returns:
        list[Path]: The files, in name order.
    """
    directory = PROJECT_ROOT / rel_dir
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.glob("*.json") if path.is_file())


def card_identity(index):
    """Builds the ` _ ` form of a card index, exactly like `readCardKeySet` of the linter.

    Args:
        index: Card index as written in a catalogue (`SERIE-A1 / W001`).

    Returns:
        str: The identity part of the collection key.
    """
    return " _ ".join(part.strip() for part in str(index).split("/") if part.strip())


def collect_languages():
    """Reads the language codes declared by `settings/config.json`.

    Args:
        None.

    Returns:
        list[str]: Lowercase codes, French first when present.
    """
    config = read_json("settings/config.json", {}) or {}
    declared = config.get("languages", [])
    codes = []
    if isinstance(declared, list):
        for entry in declared:
            if isinstance(entry, dict):
                code = entry.get("code") or entry.get("id") or ""
            else:
                code = entry
            if isinstance(code, str) and code.strip() != "":
                codes.append(code.strip().lower())
    if not codes:
        codes = ["fr", "en"]
    return codes


def collect_card_catalogues():
    """Reads every card catalogue once.

    Returns:
        tuple[list[str], list[str], dict[str, dict[str, str]]]: The sorted card indexes, the sorted
        collection keys (`<Index>_<layout>`) and the French/English name of every index, so the
        page can search a card field by name as well as by index.
    """
    indexes = set()
    keys = set()
    names = {}
    for rel_dir in ("data/boosters", "data/promo_cards"):
        for path in json_files(rel_dir):
            root = read_json(path.relative_to(PROJECT_ROOT).as_posix(), {}) or {}
            cards = root.get("Cards") if isinstance(root, dict) else None
            if not isinstance(cards, list):
                cards = root.get("Card") if isinstance(root, dict) else None
            if not isinstance(cards, list):
                continue
            for card in cards:
                if not isinstance(card, dict):
                    continue
                index = card.get("Index")
                layout = card.get("Layout")
                if not isinstance(index, str) or index.strip() == "":
                    continue
                index = index.strip()
                indexes.add(index)
                if isinstance(layout, str) and layout.strip() != "":
                    keys.add(f"{card_identity(index)}_{layout.strip()}")
                if index not in names:
                    fr = card.get("Name_FR") or card.get("Name")
                    en = card.get("Name_EN") or card.get("Name")
                    names[index] = {
                        "fr": fr.strip() if isinstance(fr, str) else "",
                        "en": en.strip() if isinstance(en, str) else "",
                    }
    return sorted(indexes), sorted(keys), names


def collect_trophy_names():
    """Reads the name of every collection trophy, by extension.

    Args:
        None.

    Returns:
        dict[str, list[str]]: Set id to its trophy names.
    """
    names = {}
    for path in json_files("data/trophies"):
        root = read_json(path.relative_to(PROJECT_ROOT).as_posix(), {}) or {}
        trophies = root.get("TrophyList") if isinstance(root, dict) else None
        if not isinstance(trophies, list):
            continue
        names[path.stem] = sorted(
            trophy["Name"].strip()
            for trophy in trophies
            if isinstance(trophy, dict) and isinstance(trophy.get("Name"), str)
        )
    return names


def collect_title_ids():
    """Reads every title id, from the extension files and the default levels.

    Args:
        None.

    Returns:
        list[str]: The sorted ids.
    """
    ids = set()

    def walk(value):
        """Collects the `id` of every title-shaped object.

        Args:
            value: Part of a titles file.

        Returns:
            None.
        """
        if isinstance(value, dict):
            identifier = value.get("id")
            if isinstance(identifier, str) and identifier.strip() != "":
                ids.add(identifier.strip())
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    for path in json_files("data/titles"):
        walk(read_json(path.relative_to(PROJECT_ROOT).as_posix(), None))
    walk(read_json("settings/default_titles.json", None))
    return sorted(ids)


def collect_asset_paths():
    """Lists the image assets a data file may point at.

    Args:
        None.

    Returns:
        list[str]: Project paths written the way the data files write them (`./assets/...`).
    """
    suffixes = {".png", ".webp", ".gif", ".jpg", ".jpeg", ".svg"}
    directory = PROJECT_ROOT / "assets"
    if not directory.is_dir():
        return []
    paths = []
    for path in directory.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        paths.append(f"./{path.relative_to(PROJECT_ROOT).as_posix()}")
    return sorted(paths)


def collect_currencies():
    """Reads the ids of the Illager currencies.

    Args:
        None.

    Returns:
        list[str]: The declared ids.
    """
    currencies = read_json("data/illager_shop/illager_currencies.json", []) or []
    if not isinstance(currencies, list):
        return []
    return [
        currency["ID"].strip()
        for currency in currencies
        if isinstance(currency, dict) and isinstance(currency.get("ID"), str)
    ]


def collect_resources():
    """Reads the mined resources the trader prices.

    Args:
        None.

    Returns:
        list[str]: The keys of `shop.itemsValues`.
    """
    config = read_json("settings/config.json", {}) or {}
    shop = config.get("shop") if isinstance(config, dict) else None
    values = shop.get("itemsValues") if isinstance(shop, dict) else None
    return sorted(values.keys()) if isinstance(values, dict) else []


def collect_booster_sets():
    """Lists the extensions that have a booster catalogue.

    Args:
        None.

    Returns:
        list[str]: Set ids.
    """
    return [path.stem for path in json_files("data/boosters")]


def collect_suggestions():
    """Builds every list the page completes with.

    Returns:
        dict: Languages, ids, card indexes/keys, assets and the per-extension trophy names.
    """
    card_indexes, card_keys, card_names = collect_card_catalogues()
    icons = read_json("data/icon.json", []) or []
    icon_names = sorted(
        icon["name"].strip()
        for icon in icons
        if isinstance(icon, dict) and isinstance(icon.get("name"), str)
    )
    return {
        "languages": collect_languages(),
        "currencies": collect_currencies(),
        "questTypes": list(QUEST_TYPES),
        "rewardTypes": list(ILLAGER_REWARD_TYPES),
        "trophyRarities": list(TROPHY_RARITIES),
        "requirementLayouts": list(REQUIREMENT_LAYOUTS),
        "cardIndexes": card_indexes,
        "cardKeys": card_keys,
        "cardNames": card_names,
        "boosterSets": collect_booster_sets(),
        "resources": collect_resources(),
        "assetPaths": collect_asset_paths(),
        "trophyNames": collect_trophy_names(),
        "iconNames": icon_names,
        "titleIds": collect_title_ids(),
    }


def discover_files():
    """Lists the editable files, re-reading the directories on every call.

    Returns:
        list[dict]: One descriptor per file (`path`, `kind`, `label`, `setId`, `size`).
    """
    files = []
    for group in FILE_GROUPS:
        kind = group["kind"]
        for path in sorted(PROJECT_ROOT.glob(group["glob"])):
            if not path.is_file():
                continue
            rel = path.relative_to(PROJECT_ROOT).as_posix()
            try:
                size = path.stat().st_size
            except OSError:
                size = 0
            files.append(
                {
                    "path": rel,
                    "kind": kind,
                    "kindLabel": KINDS[kind]["label"],
                    "description": KINDS[kind]["description"],
                    "setId": path.stem if group["per_set"] else None,
                    "size": size,
                }
            )
    return files


def editable_path(rel_path):
    """Resolves a project-relative path, refusing anything the page may not write.

    Args:
        rel_path: Path sent by the page.

    Returns:
        Path: The absolute path of the file.

    Raises:
        ValueError: When the path is not one of the editable files.
    """
    normalized = str(rel_path).replace("\\", "/").strip()
    for entry in discover_files():
        if entry["path"] == normalized:
            return PROJECT_ROOT / normalized
    raise ValueError(f"{rel_path!r} is not an editable data file.")


def detect_newline(raw):
    """Tells which line ending a file uses.

    Args:
        raw: The file bytes, or None.

    Returns:
        str: `\\r\\n` or `\\n`.
    """
    if not raw:
        return "\n"
    return "\r\n" if b"\r\n" in raw[:4096] else "\n"


def to_disk_text(content, newline):
    """Normalizes the text sent by the browser to the file's own line ending.

    Args:
        content: Text of the editor (always `\\n`).
        newline: Line ending of the file.

    Returns:
        str: The text to write.
    """
    text = str(content).replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    return text.replace("\n", newline)


def node_binary():
    """Finds the Node.js executable used to run the linter.

    Returns:
        str: The executable path.

    Raises:
        RuntimeError: When Node.js is not installed.
    """
    binary = shutil.which("node") or shutil.which("node.exe")
    if not binary:
        raise RuntimeError(
            "Node.js is required: the editor validates every save with tools/lint.mjs."
        )
    return binary


def run_lint(rel_path, content):
    """Runs the data rules of the linter on a candidate content.

    The candidate travels through the `LINT_OVERLAY_FILE` overlay of `tools/lint/lib/repo.mjs`: the
    rules read it instead of the file on disk, so validating NEVER writes the real file and an
    abandoned edit leaves no trace.

    Args:
        rel_path: Project-relative path of the file the content belongs to.
        content: Candidate text, already carrying the line endings of the file.

    Returns:
        dict: `{files, errors, warnings, diagnostics}`.

    Raises:
        RuntimeError: When the linter cannot run or prints no report.
    """
    command = [node_binary(), "tools/lint.mjs", "--json", "--only", "data/"]
    with tempfile.TemporaryDirectory(prefix="minecards-lint-") as directory:
        overlay_path = Path(directory) / "overlay.json"
        overlay_path.write_text(json.dumps({rel_path: content}), encoding="utf-8")
        environment = dict(os.environ)
        environment["LINT_OVERLAY_FILE"] = str(overlay_path)
        completed = subprocess.run(
            command,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=LINT_TIMEOUT_SECONDS,
            env=environment,
        )
    output = (completed.stdout or "").strip() or (completed.stderr or "").strip()
    start = output.find("{")
    if start < 0:
        raise RuntimeError(f"The linter printed no JSON report: {output[:400]}")
    try:
        return json.loads(output[start:])
    except ValueError as error:
        raise RuntimeError(f"The linter report is not valid JSON: {error}") from error


def lint_for_file(rel_path, content):
    """Keeps the diagnostics that concern one file, plus the rules that failed outright.

    Args:
        rel_path: Project-relative path of the edited file.
        content: Candidate text the rules must read instead of the file.

    Returns:
        list[dict]: The diagnostics, sorted by line.

    Raises:
        RuntimeError: When the linter cannot run.
    """
    report = run_lint(rel_path, content)
    diagnostics = []
    for diagnostic in report.get("diagnostics", []):
        file = str(diagnostic.get("file", "")).replace("\\", "/")
        if file == rel_path or file.startswith("tools/lint.mjs"):
            diagnostics.append(
                {
                    "rule": diagnostic.get("ruleId", ""),
                    "severity": diagnostic.get("severity", "error"),
                    "line": int(diagnostic.get("line") or 1),
                    "column": int(diagnostic.get("column") or 1),
                    "message": str(diagnostic.get("message", "")),
                }
            )
    diagnostics.sort(key=lambda entry: (entry["line"], entry["column"], entry["message"]))
    return diagnostics


def syntax_diagnostic(content, error):
    """Turns a JSON syntax error into the same shape as a lint diagnostic.

    Args:
        content: The text that failed to parse.
        error: The `json.JSONDecodeError`.

    Returns:
        dict: One diagnostic.
    """
    line = int(getattr(error, "lineno", 1) or 1)
    column = int(getattr(error, "colno", 1) or 1)
    return {
        "rule": "json/syntax",
        "severity": "error",
        "line": line,
        "column": column,
        "message": f"JSON invalide : {error.msg}",
    }


def apply_content(rel_path, content, keep):
    """Validates a candidate content, writing it only when the linter accepts it.

    Nothing reaches the disk before the linter agreed: the candidate is handed to the rules through
    the overlay of `tools/lint/lib/repo.mjs`. A save then writes the bytes once; a refused save
    leaves the file exactly as it was, which is what makes a keystroke free.

    Args:
        rel_path: Project-relative path of the file.
        content: Candidate text.
        keep: True to write the new content when it passes (a save), False to only validate it.

    Returns:
        dict: `{ok, saved, diagnostics, content, syntax}`.
    """
    target = editable_path(rel_path)
    raw = target.read_bytes() if target.exists() else None
    disk_text = to_disk_text(content, detect_newline(raw))
    try:
        json.loads(disk_text)
    except json.JSONDecodeError as error:
        return {
            "ok": False,
            "saved": False,
            "syntax": True,
            "content": disk_text,
            "diagnostics": [syntax_diagnostic(disk_text, error)],
        }

    diagnostics = lint_for_file(rel_path, disk_text)
    errors = [entry for entry in diagnostics if entry["severity"] == "error"]
    if keep and not errors:
        target.write_text(disk_text, encoding="utf-8", newline="")
        return {
            "ok": True,
            "saved": True,
            "syntax": False,
            "content": disk_text,
            "diagnostics": diagnostics,
        }

    return {
        "ok": not errors,
        "saved": False,
        "syntax": False,
        "content": disk_text,
        "diagnostics": diagnostics,
    }


class DataEditorHandler(SimpleHTTPRequestHandler):
    """Serves the editor page, its assets and the JSON API."""

    server_version = "MineCardsDataEditors/1.0"

    def __init__(self, *args, **kwargs):
        """Serves the project root, which holds both `admin/` and `data/`.

        Args:
            *args: Positional arguments of `SimpleHTTPRequestHandler`.
            **kwargs: Keyword arguments of `SimpleHTTPRequestHandler`.
        """
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def send_response(self, code, message=None):
        """Starts a response with no cache directive sent yet.

        Args:
            code: HTTP status code.
            message: Optional status message.

        Returns:
            None.
        """
        self.cache_header_sent = False
        super().send_response(code, message)

    def log_message(self, format, *args):
        """Keeps the console readable: one short line per request.

        Args:
            format: printf-style format of the message.
            *args: Its arguments.

        Returns:
            None.
        """
        print(f"  {self.address_string()} {format % args}")

    def is_loopback(self):
        """Tells whether this request really targets the local machine.

        A browser on another machine cannot reach the bound address, but a malicious page could
        resolve a domain to 127.0.0.1: the `Host` header is what separates the two.

        Returns:
            bool: True when the request may be served.
        """
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        return host in ("127.0.0.1", "localhost", "[::1]", "::1")

    def end_headers(self):
        """Forbids a browser cache from serving a stale page, script or stylesheet.

        The editor edits the project it is served from: a page reload must show the file as it is
        now, not as it was when the browser stored it. `no-cache` still allows a conditional
        request, so an unchanged file costs a 304 and nothing more.

        Returns:
            None.
        """
        if not getattr(self, "cache_header_sent", False):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, payload, status=HTTPStatus.OK):
        """Writes a JSON response that no browser may cache.

        Args:
            payload: JSON-serializable value.
            status: HTTP status.

        Returns:
            None.
        """
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cache_header_sent = True
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        """Reads the JSON body of a POST request.

        Returns:
            dict: The parsed body, or an empty dict.

        Raises:
            ValueError: When the body is not a JSON object.
        """
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            value = json.loads(raw.decode("utf-8"))
        except ValueError as error:
            raise ValueError(f"Invalid JSON body: {error}") from error
        if not isinstance(value, dict):
            raise ValueError("The request body must be a JSON object.")
        return value

    def do_GET(self):
        """Serves the API reads, the page index and the static files.

        Returns:
            None.
        """
        if not self.is_loopback():
            self.send_error(HTTPStatus.FORBIDDEN, "Loopback only.")
            return

        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", PAGE_PATH)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if parsed.path == "/api/bootstrap":
            self.handle_bootstrap()
            return
        if parsed.path == "/api/file":
            self.handle_file(parsed.query)
            return
        super().do_GET()

    def do_POST(self):
        """Serves the validation and the save of a file.

        Returns:
            None.
        """
        if not self.is_loopback():
            self.send_error(HTTPStatus.FORBIDDEN, "Loopback only.")
            return

        parsed = urlparse(self.path)
        try:
            body = self.read_body()
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if parsed.path == "/api/validate":
            self.handle_write(body, keep=False)
        elif parsed.path == "/api/save":
            self.handle_write(body, keep=True)
        else:
            self.send_json({"error": "Unknown route."}, HTTPStatus.NOT_FOUND)

    def handle_bootstrap(self):
        """Sends the files, the schemas and every suggestion list, once per page load.

        Returns:
            None.
        """
        try:
            self.send_json(
                {
                    "files": discover_files(),
                    "kinds": KINDS,
                    "schemas": SCHEMAS,
                    "suggestions": collect_suggestions(),
                    "root": str(PROJECT_ROOT),
                }
            )
        except Exception as error:  # noqa: BLE001 - reported to the page instead of the console.
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_file(self, query):
        """Reads one editable file and its parsed value.

        Args:
            query: Raw query string (`?path=...`).

        Returns:
            None.
        """
        params = parse_qs(query)
        rel_path = (params.get("path") or [""])[0]
        try:
            target = editable_path(rel_path)
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.NOT_FOUND)
            return
        try:
            raw = target.read_bytes()
            content = raw.decode("utf-8")
            value = json.loads(content)
        except (OSError, ValueError) as error:
            self.send_json(
                {"error": f"{rel_path} cannot be read: {error}", "path": rel_path},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
            return
        entry = next((item for item in discover_files() if item["path"] == rel_path), None)
        self.send_json(
            {
                "path": rel_path,
                "kind": entry["kind"] if entry else None,
                "setId": entry["setId"] if entry else None,
                "content": content,
                "value": value,
            }
        )

    def handle_write(self, body, keep):
        """Validates (and optionally keeps) a candidate content.

        Args:
            body: `{path, content}` sent by the page.
            keep: True to save, False to only validate.

        Returns:
            None.
        """
        rel_path = str(body.get("path") or "")
        content = body.get("content")
        if not isinstance(content, str):
            self.send_json({"error": "The content must be a string."}, HTTPStatus.BAD_REQUEST)
            return
        try:
            payload = apply_content(rel_path, content, keep)
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.NOT_FOUND)
            return
        except subprocess.TimeoutExpired:
            self.send_json(
                {"error": "The linter took too long; nothing was written."},
                HTTPStatus.GATEWAY_TIMEOUT,
            )
            return
        except Exception as error:  # noqa: BLE001 - the page shows the sentence.
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.send_json(payload)


def serve(port, open_browser):
    """Starts the loopback server.

    Args:
        port: TCP port to bind.
        open_browser: True to open the page in the default browser.

    Returns:
        None.
    """
    server = ThreadingHTTPServer(("127.0.0.1", port), DataEditorHandler)
    url = f"http://127.0.0.1:{port}{PAGE_PATH}"
    print("MineCards data editors")
    print(f"  project: {PROJECT_ROOT}")
    print(f"  page:    {url}")
    print("  Ctrl+C to stop.")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def main():
    """Reads the command line and starts the server.

    Returns:
        None.
    """
    parser = argparse.ArgumentParser(
        description="Serve admin/data_editors.html and the JSON API it edits the data files with."
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="TCP port (default 8770).")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the page in the default browser.",
    )
    arguments = parser.parse_args()
    serve(arguments.port, not arguments.no_browser)


if __name__ == "__main__":
    main()
