#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import shutil
import time
from typing import Any, Dict, List

try:
    import requests
except ImportError:
    raise SystemExit("Le module 'requests' est requis. Installez-le avec: pip install requests")

JSON_FILENAME = "pokemons.json"
BACKUP_FILENAME = JSON_FILENAME + ".bak"
API_URL_TEMPLATE = "https://tyradex.app/api/v1/pokemon/{id}"
REQUEST_TIMEOUT = 10
SLEEP_BETWEEN_REQUESTS = 0.2

def extract_numeric_part(idx: str) -> str:
    """Extrait la partie numérique initiale d'un index (ex '058-B' -> '058', '35-A' -> '35', '001' -> '001').
    Retourne '' si aucune partie numérique trouvée."""
    if not isinstance(idx, str):
        return ""
    m = re.match(r"^(\d+)", idx)
    return m.group(1) if m else ""

def normalize_id(numeric_part: str) -> str:
    """Normalise en entier sans zéros de tête (ex '001' -> '1')."""
    if numeric_part == "":
        return ""
    return str(int(numeric_part))

def fetch_pokemon_data(identifier: str) -> Dict[str, Any]:
    if not identifier:
        return {}
    url = API_URL_TEMPLATE.format(id=identifier)
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Erreur API pour id={identifier}: {e}")
        return {}

def extract_category_and_egg_groups(api_json: Dict[str, Any]) -> (str, List[str]):
    category = ""
    egg_groups: List[str] = []

    # category
    if "category" in api_json and api_json["category"]:
        if isinstance(api_json["category"], str):
            category = api_json["category"]
        elif isinstance(api_json["category"], dict):
            for key in ("name", "fr", "en"):
                if key in api_json["category"] and isinstance(api_json["category"][key], str):
                    category = api_json["category"][key]
                    break

    # egg_groups
    if "egg_groups" in api_json:
        eg = api_json["egg_groups"]
        if eg is None:
            # règle 2 : si null -> "Inconnu"
            egg_groups = ["Inconnu"]
        elif isinstance(eg, list):
            tmp: List[str] = []
            for item in eg:
                if isinstance(item, str):
                    tmp.append(item)
                elif isinstance(item, dict):
                    for key in ("name", "fr", "en"):
                        if key in item and isinstance(item[key], str):
                            tmp.append(item[key])
                            break
            # si la liste est vide après extraction, considérer "Inconnu"
            egg_groups = [e.strip() for e in dict.fromkeys(tmp) if e and isinstance(e, str)]
            if not egg_groups:
                egg_groups = ["Inconnu"]
        else:
            # cas inattendu
            egg_groups = ["Inconnu"]

    return category, egg_groups

def main():
    if not os.path.exists(JSON_FILENAME):
        print(f"Fichier introuvable: {JSON_FILENAME}")
        return

    # sauvegarde
    shutil.copy2(JSON_FILENAME, BACKUP_FILENAME)
    print(f"Sauvegarde créée: {BACKUP_FILENAME}")

    with open(JSON_FILENAME, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Erreur lecture JSON: {e}")
            return

    if not isinstance(data, list):
        print("Le fichier JSON doit contenir une liste d'objets.")
        return

    not_filled_indices: List[str] = []

    for entry in data:
        if not isinstance(entry, dict):
            continue

        raw_idx = entry.get("Index", "")
        if not isinstance(raw_idx, str):
            raw_idx = str(raw_idx)

        numeric_part = extract_numeric_part(raw_idx)
        identifier = normalize_id(numeric_part) if numeric_part else ""

        # état initial pour détecter modification
        before_category = entry.get("Category", None)
        before_eggs = entry.get("EggGroups", None)

        if identifier:
            api_json = fetch_pokemon_data(identifier)
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            category, egg_groups = extract_category_and_egg_groups(api_json)

            # écrire/mettre à jour Category
            if "Category" not in entry or entry.get("Category") in (None, ""):
                entry["Category"] = category if category else ""
            # écrire/mettre à jour EggGroups
            if "EggGroups" not in entry or not isinstance(entry.get("EggGroups"), list) or len(entry.get("EggGroups")) == 0:
                entry["EggGroups"] = egg_groups if egg_groups else []
        else:
            # index sans partie numérique : créer les propriétés vides si absentes
            if "Category" not in entry:
                entry["Category"] = ""
            if "EggGroups" not in entry:
                entry["EggGroups"] = []

        # log si modifié
        after_category = entry.get("Category", None)
        after_eggs = entry.get("EggGroups", None)
        if before_category != after_category or before_eggs != after_eggs:
            print(f"index {raw_idx} updated")

        # vérifier remplissage complet
        cat_filled = isinstance(entry.get("Category"), str) and entry.get("Category") != ""
        eggs_filled = isinstance(entry.get("EggGroups"), list) and len(entry.get("EggGroups")) > 0
        if not (cat_filled and eggs_filled):
            not_filled_indices.append(raw_idx)

    # écrire le fichier mis à jour
    with open(JSON_FILENAME, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Fichier mis à jour: {JSON_FILENAME}")
    if not_filled_indices:
        print("Indices pour lesquels Category ou EggGroups n'ont pas été remplis complètement :")
        for i in not_filled_indices:
            print(" -", i)
    else:
        print("Toutes les entrées ont Category et EggGroups remplis.")

    return not_filled_indices

if __name__ == "__main__":
    main()
