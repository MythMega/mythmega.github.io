import json

# --- CONFIG ---
INPUT_FILE = "pokemons_wip.json"
OUTPUT_FILE = "pokemon_updated.json"
VERSION_SWITCH_INDEX = 425  # les 425 premières → version 1

# --- LECTURE ---
with open(INPUT_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

# --- TRAITEMENT ---
first_v2_name = None

for i, entry in enumerate(data):
    if i < VERSION_SWITCH_INDEX:
        entry["pokefeet_data_version"] = 1
    else:
        entry["pokefeet_data_version"] = 2
        if first_v2_name is None:
            first_v2_name = entry.get("NameFR")

# --- ÉCRITURE ---
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# --- AFFICHAGE ---
print("Première entrée en pokefeet_data_version 2 :", first_v2_name)
