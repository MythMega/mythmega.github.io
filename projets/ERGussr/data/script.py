#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
import os
import logging
from collections import OrderedDict

# --- Configuration fichiers ---
INPUT_FR = "fr.json"
INPUT_EN = "en.json"
WRITE_CLEANED = True
LOG_FILE = "build_datasets.log"
VERBOSE = True  # True pour plus de logs détaillés

# --- Output dataset filenames ---
OUTPUT_GOODS = "Dataset-goods.json"
OUTPUT_WEAPONS = "Dataset-weapon.json"
OUTPUT_ARMOR = "Dataset-armor.json"
OUTPUT_MAGIC = "Dataset-magic.json"
OUTPUT_ACCESSORIES = "Dataset-accessories.json"

# --- Mapping des suffixes -> clés internes pour chaque catégorie et langue ---
TARGET_GOODS_FR = {
    "GoodsName.fmg": "NameFR",
    "GoodsInfo.fmg": "Desc1FR",
    "GoodsInfo2.fmg": "Desc2FR",
    "GoodsCaption.fmg": "Desc3FR",
}
TARGET_GOODS_EN = {
    "GoodsName.fmg": "NameEN",
    "GoodsInfo.fmg": "Desc1EN",
    "GoodsInfo2.fmg": "Desc2EN",
    "GoodsCaption.fmg": "Desc3EN",
}

TARGET_WEAPONS_FR = {
    "WeaponName.fmg": "NameFR",
    "WeaponInfo.fmg": "Desc1FR",
    "WeaponCaption.fmg": "Desc2FR",
}
TARGET_WEAPONS_EN = {
    "WeaponName.fmg": "NameEN",
    "WeaponInfo.fmg": "Desc1EN",
    "WeaponCaption.fmg": "Desc2EN",
}

TARGET_ARMOR_FR = {
    "ProtectorName.fmg": "NameFR",
    "ProtectorInfo.fmg": "Desc1FR",
    "ProtectorCaption.fmg": "Desc2FR",
}
TARGET_ARMOR_EN = {
    "ProtectorName.fmg": "NameEN",
    "ProtectorInfo.fmg": "Desc1EN",
    "ProtectorCaption.fmg": "Desc2EN",
}

TARGET_MAGIC_FR = {
    "MagicName.fmg": "NameFR",
    "MagicInfo.fmg": "Desc1FR",
    "MagicCaption.fmg": "Desc2FR",
}
TARGET_MAGIC_EN = {
    "MagicName.fmg": "NameEN",
    "MagicInfo.fmg": "Desc1EN",
    "MagicCaption.fmg": "Desc2EN",
}

TARGET_ACCESS_FR = {
    "AccessoryName.fmg": "NameFR",
    "AccessoryInfo.fmg": "Desc1FR",
    "AccessoryCaption.fmg": "Desc2FR",
}
TARGET_ACCESS_EN = {
    "AccessoryName.fmg": "NameEN",
    "AccessoryInfo.fmg": "Desc1EN",
    "AccessoryCaption.fmg": "Desc2EN",
}

INVALID_FILENAME_RE = re.compile(r'[\/\\\:\*\?\"\<\>\|\n\r\t]')

# --- Logging setup ---
logger = logging.getLogger("build_datasets")
logger.setLevel(logging.DEBUG if VERBOSE else logging.INFO)
formatter = logging.Formatter("%(asctime)s %(levelname)s: %(message)s", "%Y-%m-%d %H:%M:%S")

# console handler
ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG if VERBOSE else logging.INFO)
ch.setFormatter(formatter)
logger.addHandler(ch)

# file handler
fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
fh.setLevel(logging.DEBUG)
fh.setFormatter(formatter)
logger.addHandler(fh)

# --- Helpers ---
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def find_target_maps(bigjson, target_suffixes, lang_tag):
    """
    Retourne dict short_key -> mapping id->value
    Loggue les suffixes attendus qui n'ont pas été trouvés.
    """
    found = {}
    present_suffixes = set()
    for fullkey, mapping in bigjson.items():
        for suffix, short in target_suffixes.items():
            if fullkey.endswith(suffix):
                present_suffixes.add(suffix)
                if isinstance(mapping, dict):
                    found[short] = mapping.copy()
                else:
                    found[short] = {}
    # garantir toutes les clés
    for suffix, short in target_suffixes.items():
        if short not in found:
            found[short] = {}
            logger.warning("[%s] Propriété attendue introuvable: %s (clé recherchée se terminant par '%s')", lang_tag, short, suffix)
    if VERBOSE:
        logger.info("[%s] Suffixes trouvés pour cette source: %s", lang_tag, ", ".join(sorted(present_suffixes)) if present_suffixes else "(aucun)")
    return found

def id_key(k):
    try:
        return int(k)
    except Exception:
        return k

def clean_map_remove_nulls_and_dedup(mapping, short_key, lang_tag):
    """
    - supprime les valeurs None / vides
    - déduplique par valeur (garde première occurrence par ID trié numériquement)
    Retourne OrderedDict trié par ID numérique.
    """
    seen = set()
    cleaned = OrderedDict()
    for k in sorted(mapping.keys(), key=id_key):
        v = mapping[k]
        if v is None:
            continue
        v_str = str(v).strip()
        if v_str == "":
            continue
        if v_str in seen:
            continue
        seen.add(v_str)
        cleaned[str(k)] = v_str
    if len(cleaned) == 0:
        logger.warning("[%s] Après nettoyage, la map '%s' est vide.", lang_tag, short_key)
    else:
        logger.info("[%s] Cleaned '%s' -> %d entrées", lang_tag, short_key, len(cleaned))
    return cleaned

def sanitize_filename(name):
    if not name:
        return "unnamed"
    s = str(name).strip()
    s = s.replace("\r", " ").replace("\n", " ")
    s = INVALID_FILENAME_RE.sub("", s)
    s = re.sub(r"\s+", "_", s)
    if len(s) > 120:
        s = s[:120].rstrip("_")
    if s == "":
        s = "unnamed"
    return s

def build_dataset_for_category(cleaned_fr, cleaned_en, keys_fr, keys_en, id_prefix, picture_dir, include_desc3=False, category_name=""):
    """
    cleaned_fr/en: dict short_key -> OrderedDict(id->str)
    keys_fr/en: list of short keys in order [Name, Desc1, Desc2, (Desc3)]
    id_prefix: e.g. "Goods-", "Weapons-", "Armor-", "Mafic-", "Accessories-"
    picture_dir: "./Assets/Goods/" etc.
    include_desc3: bool
    """
    # extraire maps
    name_fr_map = cleaned_fr.get(keys_fr[0], {})
    desc1_fr_map = cleaned_fr.get(keys_fr[1], {})
    desc2_fr_map = cleaned_fr.get(keys_fr[2], {})
    desc3_fr_map = cleaned_fr.get(keys_fr[3], {}) if include_desc3 and len(keys_fr) > 3 else {}

    name_en_map = cleaned_en.get(keys_en[0], {})
    desc1_en_map = cleaned_en.get(keys_en[1], {})
    desc2_en_map = cleaned_en.get(keys_en[2], {})
    desc3_en_map = cleaned_en.get(keys_en[3], {}) if include_desc3 and len(keys_en) > 3 else {}

    ids = set()
    ids.update(name_fr_map.keys())
    ids.update(name_en_map.keys())

    if not ids:
        logger.warning("Aucun ID trouvé pour la catégorie '%s' (préfixe %s). Vérifiez les clés sources.", category_name, id_prefix)

    dataset = []
    used_filenames = {}

    for id_str in sorted(ids, key=id_key):
        name_fr = name_fr_map.get(id_str, "")
        name_en = name_en_map.get(id_str, "")
        desc1_fr = desc1_fr_map.get(id_str, "")
        desc2_fr = desc2_fr_map.get(id_str, "")
        desc1_en = desc1_en_map.get(id_str, "")
        desc2_en = desc2_en_map.get(id_str, "")
        desc3_fr = desc3_fr_map.get(id_str, "") if include_desc3 else ""
        desc3_en = desc3_en_map.get(id_str, "") if include_desc3 else ""

        base_for_filename = name_fr if name_fr else name_en
        sanitized = sanitize_filename(base_for_filename)
        if sanitized in used_filenames:
            filename = f"{sanitized}_{id_str}"
        else:
            filename = sanitized
        used_filenames[sanitized] = used_filenames.get(sanitized, 0) + 1

        picture_url = f"{picture_dir}{filename}.png"

        item = {
            "ID": f"{id_prefix}{id_str}",
            "NameFR": name_fr,
            "Desc1FR": desc1_fr,
            "Desc2FR": desc2_fr,
            "NameEN": name_en,
            "Desc1EN": desc1_en,
            "Desc2EN": desc2_en,
            "PictureURL": picture_url
        }
        if include_desc3:
            item["Desc3FR"] = desc3_fr
            item["Desc3EN"] = desc3_en

        dataset.append(item)

    logger.info("Catégorie '%s' -> %d items générés", category_name, len(dataset))
    return dataset

def main():
    logger.info("Démarrage du script de génération des datasets")
    if not os.path.exists(INPUT_FR):
        logger.error("Fichier FR introuvable: %s", INPUT_FR)
        return
    if not os.path.exists(INPUT_EN):
        logger.error("Fichier EN introuvable: %s", INPUT_EN)
        return

    try:
        big_fr = load_json(INPUT_FR)
        big_en = load_json(INPUT_EN)
    except Exception as e:
        logger.exception("Erreur lors du chargement des fichiers JSON: %s", e)
        return

    # --- Goods ---
    logger.info("Traitement de la catégorie Goods")
    maps_goods_fr = find_target_maps(big_fr, TARGET_GOODS_FR, "FR")
    maps_goods_en = find_target_maps(big_en, TARGET_GOODS_EN, "EN")
    cleaned_goods_fr = {}
    cleaned_goods_en = {}
    for k, m in maps_goods_fr.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "FR")
        cleaned_goods_fr[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_FR.json")
    for k, m in maps_goods_en.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "EN")
        cleaned_goods_en[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_EN.json")

    dataset_goods = build_dataset_for_category(
        cleaned_goods_fr, cleaned_goods_en,
        keys_fr=["NameFR", "Desc1FR", "Desc2FR", "Desc3FR"],
        keys_en=["NameEN", "Desc1EN", "Desc2EN", "Desc3EN"],
        id_prefix="Goods-",
        picture_dir="./Assets/Goods/",
        include_desc3=True,
        category_name="Goods"
    )
    save_json(dataset_goods, OUTPUT_GOODS)
    logger.info("Wrote %s (%d items)", OUTPUT_GOODS, len(dataset_goods))

    # --- Weapons ---
    logger.info("Traitement de la catégorie Weapons")
    maps_weap_fr = find_target_maps(big_fr, TARGET_WEAPONS_FR, "FR")
    maps_weap_en = find_target_maps(big_en, TARGET_WEAPONS_EN, "EN")
    cleaned_weap_fr = {}
    cleaned_weap_en = {}
    for k, m in maps_weap_fr.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "FR")
        cleaned_weap_fr[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_FR.json")
    for k, m in maps_weap_en.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "EN")
        cleaned_weap_en[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_EN.json")

    dataset_weapons = build_dataset_for_category(
        cleaned_weap_fr, cleaned_weap_en,
        keys_fr=["NameFR", "Desc1FR", "Desc2FR"],
        keys_en=["NameEN", "Desc1EN", "Desc2EN"],
        id_prefix="Weapons-",
        picture_dir="./Assets/Weapons/",
        include_desc3=False,
        category_name="Weapons"
    )
    save_json(dataset_weapons, OUTPUT_WEAPONS)
    logger.info("Wrote %s (%d items)", OUTPUT_WEAPONS, len(dataset_weapons))

    # --- Armor (Protector) ---
    logger.info("Traitement de la catégorie Armor")
    maps_arm_fr = find_target_maps(big_fr, TARGET_ARMOR_FR, "FR")
    maps_arm_en = find_target_maps(big_en, TARGET_ARMOR_EN, "EN")
    cleaned_arm_fr = {}
    cleaned_arm_en = {}
    for k, m in maps_arm_fr.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "FR")
        cleaned_arm_fr[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_FR.json")
    for k, m in maps_arm_en.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "EN")
        cleaned_arm_en[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_EN.json")

    dataset_armor = build_dataset_for_category(
        cleaned_arm_fr, cleaned_arm_en,
        keys_fr=["NameFR", "Desc1FR", "Desc2FR"],
        keys_en=["NameEN", "Desc1EN", "Desc2EN"],
        id_prefix="Armor-",
        picture_dir="./Assets/Armors/",
        include_desc3=False,
        category_name="Armor"
    )
    save_json(dataset_armor, OUTPUT_ARMOR)
    logger.info("Wrote %s (%d items)", OUTPUT_ARMOR, len(dataset_armor))

    # --- Magic (Sorts) ---
    logger.info("Traitement de la catégorie Magic")
    maps_magic_fr = find_target_maps(big_fr, TARGET_MAGIC_FR, "FR")
    maps_magic_en = find_target_maps(big_en, TARGET_MAGIC_EN, "EN")
    cleaned_magic_fr = {}
    cleaned_magic_en = {}
    for k, m in maps_magic_fr.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "FR")
        cleaned_magic_fr[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_FR.json")
    for k, m in maps_magic_en.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "EN")
        cleaned_magic_en[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_EN.json")

    dataset_magic = build_dataset_for_category(
        cleaned_magic_fr, cleaned_magic_en,
        keys_fr=["NameFR", "Desc1FR", "Desc2FR"],
        keys_en=["NameEN", "Desc1EN", "Desc2EN"],
        id_prefix="Mafic-",
        picture_dir="./Assets/Magic/",
        include_desc3=False,
        category_name="Magic"
    )
    save_json(dataset_magic, OUTPUT_MAGIC)
    logger.info("Wrote %s (%d items)", OUTPUT_MAGIC, len(dataset_magic))

    # --- Accessories ---
    logger.info("Traitement de la catégorie Accessories")
    maps_acc_fr = find_target_maps(big_fr, TARGET_ACCESS_FR, "FR")
    maps_acc_en = find_target_maps(big_en, TARGET_ACCESS_EN, "EN")
    cleaned_acc_fr = {}
    cleaned_acc_en = {}
    for k, m in maps_acc_fr.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "FR")
        cleaned_acc_fr[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_FR.json")
    for k, m in maps_acc_en.items():
        cleaned = clean_map_remove_nulls_and_dedup(m, k, "EN")
        cleaned_acc_en[k] = cleaned
        if WRITE_CLEANED:
            save_json(cleaned, f"cleaned_{k}_EN.json")

    dataset_access = build_dataset_for_category(
        cleaned_acc_fr, cleaned_acc_en,
        keys_fr=["NameFR", "Desc1FR", "Desc2FR"],
        keys_en=["NameEN", "Desc1EN", "Desc2EN"],
        id_prefix="Accessories-",
        picture_dir="./Assets/Accessories/",
        include_desc3=False,
        category_name="Accessories"
    )
    save_json(dataset_access, OUTPUT_ACCESSORIES)
    logger.info("Wrote %s (%d items)", OUTPUT_ACCESSORIES, len(dataset_access))

    logger.info("Traitement terminé. Voir %s pour les logs détaillés.", LOG_FILE)

if __name__ == "__main__":
    main()
