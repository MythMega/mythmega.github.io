#!/usr/bin/env python3
# coding: utf-8

import json
import os
from collections import OrderedDict

EZMOD_FILE = "_ezmod.json"
SKIP_PREFIX = "_"            # fichiers commençant par "_" sont ignorés
SIMPL_SUFFIX = "-simpl.json" # suffixe ajouté aux fichiers générés

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def build_ezmod_rules(path):
    if not os.path.exists(path):
        print(f"Fichier de règles introuvable : {path}")
        return []
    raw = load_json(path)
    rules = []
    for entry in raw:
        delete_ids = entry.get("Delete", {}).get("IDS", []) or []
        replace_list = entry.get("ReplaceIfFound", []) or []
        delete_ids = {str(x) for x in delete_ids if x is not None}
        rules.append({
            "delete_ids": delete_ids,
            "replace": replace_list
        })
    return rules

def normalize_flags_value(flags):
    """Retourne une liste de flags contenant 'Simplified' à partir d'une valeur quelconque."""
    if flags is None:
        return ["Simplified"]
    if isinstance(flags, list):
        normalized = [str(x) for x in flags if x is not None]
        if "Simplified" not in normalized:
            normalized.append("Simplified")
        return normalized
    # autre type -> convertir en string et garder + Simplified
    try:
        s = str(flags)
        if s.strip() == "":
            return ["Simplified"]
        if "Simplified" in s:
            return [s]
        return [s, "Simplified"]
    except Exception:
        return ["Simplified"]

def process_file(src_path, ezmod_rules):
    try:
        src = load_json(src_path)
    except Exception as e:
        print(f"Erreur lecture {src_path}: {e}")
        return

    items = src.get("Items", []) or []
    index_to_item = { str(item.get("Index")): item for item in items if item.get("Index") is not None }
    final_items = list(items)

    total_deleted = 0
    total_added = 0

    for rule in ezmod_rules:
        delete_ids = rule["delete_ids"]
        replace_list = rule["replace"]

        applies = False
        if not delete_ids:
            applies = True
        else:
            applies = any(d in index_to_item for d in delete_ids)

        if not applies:
            continue

        if delete_ids:
            new_final = []
            deleted_count = 0
            for it in final_items:
                idx = it.get("Index")
                if idx is not None and str(idx) in delete_ids:
                    deleted_count += 1
                    index_to_item.pop(str(idx), None)
                else:
                    new_final.append(it)
            final_items = new_final
            total_deleted += deleted_count

        for repl in replace_list:
            repl_idx = repl.get("Index")
            if repl_idx is None:
                continue
            repl_idx = str(repl_idx)
            if any((it.get("Index") is not None and str(it.get("Index")) == repl_idx) for it in final_items):
                continue
            final_items.append(repl)
            index_to_item[repl_idx] = repl
            total_added += 1

    # Préparer la valeur finale de Flags (à partir de la valeur existante dans src si présente)
    original_flags = src.get("Flags", None)
    final_flags = normalize_flags_value(original_flags)

    # Construire un OrderedDict pour forcer l'ordre des clés : 
    # on parcourt les clés d'origine et on insère Flags AVANT Items.
    out = OrderedDict()
    flags_inserted = False
    items_inserted = False

    for key in src.keys():
        if key == "Flags":
            # on saute l'ajout ici : on insérera la version normalisée au moment opportun (avant Items)
            continue
        if key == "Items":
            # avant d'insérer Items, s'assurer d'avoir inséré Flags
            if not flags_inserted:
                out["Flags"] = final_flags
                flags_inserted = True
            out["Items"] = final_items
            items_inserted = True
            continue
        # copie des autres clés telles quelles (valeurs inchangées)
        out[key] = src[key]

    # Si le fichier source n'avait pas de clé Items (cas improbable), on ajoute Flags si pas encore ajouté
    if not flags_inserted:
        # insérer Flags avant Items position (Items non présent) -> on ajoute Flags maintenant
        # pour rester cohérent, on place Flags juste avant la fin
        out["Flags"] = final_flags
        flags_inserted = True

    # Si Items n'a pas été inséré (parce que src n'avait pas Items), on l'ajoute maintenant
    if not items_inserted:
        out["Items"] = final_items

    # Assurer unicité des Index dans Items (garder la première occurrence)
    seen = set()
    unique_items = []
    duplicates = 0
    for it in out["Items"]:
        idx = it.get("Index")
        if idx is None:
            unique_items.append(it)
            continue
        idxs = str(idx)
        if idxs in seen:
            duplicates += 1
            continue
        seen.add(idxs)
        unique_items.append(it)
    out["Items"] = unique_items

    # Sauvegarder
    base = os.path.basename(src_path)
    name, ext = os.path.splitext(base)
    out_name = f"{name}-simpl{ext}"
    out_path = os.path.join(os.path.dirname(src_path), out_name)
    save_json(out_path, out)

    print(f"{base} -> {out_name}  (deleted: {total_deleted}, added: {total_added}, duplicates_removed: {duplicates})")

def main():
    ezmod_rules = build_ezmod_rules(EZMOD_FILE)
    if not ezmod_rules:
        print("Aucune règle ezmod chargée (fichier vide ou introuvable). Le script continuera mais n'ajoutera rien.")
    for fname in sorted(os.listdir(".")):
        if not fname.endswith(".json"):
            continue
        if fname.startswith(SKIP_PREFIX):
            continue
        if fname == EZMOD_FILE:
            continue
        if fname.endswith(SIMPL_SUFFIX):
            continue
        process_file(fname, ezmod_rules)

if __name__ == "__main__":
    main()
