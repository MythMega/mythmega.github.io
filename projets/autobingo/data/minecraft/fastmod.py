#!/usr/bin/env python3
# coding: utf-8

# REQUIERT D'AVOIR DES JSON EN MODE -SIMPL
import json
import os
from collections import OrderedDict

FASTMODE_LIST = "_fastmode.json"
SKIP_PREFIX = "_"            # fichiers commençant par "_" sont ignorés
SIMPL_SUFFIX = "-simpl.json" # suffixe des fichiers d'entrée
OUT_SUFFIX = "-fastmod.json" # suffixe des fichiers de sortie

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def load_banned_ids(path):
    if not os.path.exists(path):
        print(f"Avertissement: {path} introuvable. Aucune suppression d'items ne sera faite.")
        return set()
    try:
        arr = load_json(path)
    except Exception as e:
        print(f"Erreur lecture {path}: {e}")
        return set()
    ids = set()
    if isinstance(arr, list):
        for entry in arr:
            if not isinstance(entry, dict):
                continue
            idv = entry.get("ID") or entry.get("Id") or entry.get("index")
            if idv is not None:
                ids.add(str(idv))
    return ids

def ensure_name_f(original_name):
    """Ajoute ' - F' si absent. Si Name est None, crée ' - F'."""
    if original_name is None:
        return " - F"
    s = str(original_name)
    if s.endswith(" - F"):
        return s
    if s.strip() == "":
        return " - F"
    return s + " - F"

def ensure_flags_fastmode(flags):
    """Retourne une list contenant 'FastMode' et les flags existants sans doublons."""
    if flags is None:
        return ["FastMode"]
    if isinstance(flags, list):
        normalized = []
        for f in flags:
            if f is None:
                continue
            fs = str(f)
            if fs not in normalized:
                normalized.append(fs)
        if "FastMode" not in normalized:
            normalized.append("FastMode")
        return normalized
    # autre type -> convertir en string et ajouter FastMode
    try:
        s = str(flags)
        if s.strip() == "":
            return ["FastMode"]
        if s == "FastMode":
            return [s]
        return [s, "FastMode"]
    except Exception:
        return ["FastMode"]

def remove_banned_items(items, banned_ids):
    """Supprime les items dont Index est dans banned_ids. Retourne nouvelle liste et count supprimés."""
    if not banned_ids:
        return items, 0
    new_items = []
    removed = 0
    for it in items:
        idx = it.get("Index")
        if idx is not None and str(idx) in banned_ids:
            removed += 1
            continue
        new_items.append(it)
    return new_items, removed

def ensure_unique_items(items):
    """Garde la première occurrence par Index, conserve l'ordre."""
    seen = set()
    out = []
    for it in items:
        idx = it.get("Index")
        if idx is None:
            out.append(it)
            continue
        sidx = str(idx)
        if sidx in seen:
            continue
        seen.add(sidx)
        out.append(it)
    return out

def process_simpl_file(path, banned_ids):
    try:
        src = load_json(path)
    except Exception as e:
        print(f"Erreur lecture {path}: {e}")
        return

    # Items d'origine
    items = src.get("Items", []) or []

    # Supprimer items bannis
    items, removed_count = remove_banned_items(items, banned_ids)

    # Assurer unicité
    items = ensure_unique_items(items)

    # Préparer Name et Flags
    original_name = src.get("Name", None)
    final_name = ensure_name_f(original_name)

    original_flags = src.get("Flags", None)
    final_flags = ensure_flags_fastmode(original_flags)

    # Construire OrderedDict de sortie :
    # Name (toujours en premier), puis les autres clés dans l'ordre d'origine (sauf Name/Flags/Items),
    # puis Flags, puis Items.
    out = OrderedDict()
    out["Name"] = final_name

    # copier les autres clés dans l'ordre d'origine, en ignorant Name/Flags/Items
    for key in src.keys():
        if key in ("Name", "Flags", "Items"):
            continue
        # éviter d'écraser Name si une clé "Name" réapparait (déjà inséré)
        if key not in out:
            out[key] = src[key]

    # insérer Flags juste avant Items (toujours présent)
    out["Flags"] = final_flags
    out["Items"] = items

    # Sauvegarder dans fichier remplaçant -simpl.json par -fastmod.json
    base = os.path.basename(path)
    if not base.endswith(SIMPL_SUFFIX):
        print(f"Ignoré (suffixe inattendu) : {path}")
        return
    name_root = base[:-len(SIMPL_SUFFIX)]
    out_name = f"{name_root}{OUT_SUFFIX}"
    out_path = os.path.join(os.path.dirname(path), out_name)
    try:
        save_json(out_path, out)
        print(f"{base} -> {out_name}  (items_removed: {removed_count}, items_remaining: {len(items)})")
    except Exception as e:
        print(f"Erreur écriture {out_path}: {e}")

def main():
    banned_ids = load_banned_ids(FASTMODE_LIST)
    files = sorted(os.listdir("."))
    for fname in files:
        if not fname.endswith(SIMPL_SUFFIX):
            continue
        if fname.startswith(SKIP_PREFIX):
            continue
        # traiter chaque fichier -simpl.json
        process_simpl_file(fname, banned_ids)

if __name__ == "__main__":
    main()
