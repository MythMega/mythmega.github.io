import json

# Charger le fichier JSON d'origine
with open("data_unfiltered.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Construire une nouvelle liste avec uniquement les champs désirés
filtered_data = []
for entry in data:
    filtered_entry = {
        "Name_EN": entry.get("Name_EN"),
        "Name_FR": entry.get("Name_FR"),
        "Sprite_Normal": entry.get("Sprite"),
        "Sprite_Shiny": entry.get("Sprite_Shiny")
    }
    filtered_data.append(filtered_entry)

# Sauvegarder dans un nouveau fichier
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(filtered_data, f, indent=2, ensure_ascii=False)
