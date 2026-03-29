import json

INPUT_FILE = "./data_base.json"
OUTPUT_FILE = "./data.json"

def simplify_pokemon(entry):
    evolution = entry.get("evolution") or {}

    # Sécurisation totale
    next_evo = evolution.get("next") or []
    pre_evo = evolution.get("pre")

    has_evolution = len(next_evo) > 0
    is_evolved = pre_evo is not None

    simplified = {
        "pokedex_id": entry.get("pokedex_id"),
        "generation": entry.get("generation"),
        "name": {
            "fr": entry.get("name", {}).get("fr"),
            "en": entry.get("name", {}).get("en"),
            "jp": entry.get("name", {}).get("jp")
        },
        "category": entry.get("category"),
        "catch_rate": entry.get("catch_rate"),
        "types": [t.get("name") for t in (entry.get("types") or [])],
        "height": entry.get("height"),
        "weight": entry.get("weight"),
        "has_evolution": has_evolution,
        "is_evolved": is_evolved,
        "stats": entry.get("stats"),
        "talents": [tal.get("name") for tal in (entry.get("talents") or [])],
        "egg_groups": entry.get("egg_groups") or [],
        "sprites": entry.get("sprites"),
    }

    return simplified


def main():
    # Lecture du fichier source
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Simplification
    simplified_data = [simplify_pokemon(p) for p in data]

    # Écriture du fichier final
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(simplified_data, f, ensure_ascii=False, indent=4)

    print("✔ Export terminé →", OUTPUT_FILE)


if __name__ == "__main__":
    main()
