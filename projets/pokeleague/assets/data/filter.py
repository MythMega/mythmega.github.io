import json

# Charger le fichier source
with open("pokes_unfiltered.json", "r", encoding="utf-8") as f:
    data_unfiltered = json.load(f)

# Construire le nouveau tableau filtré
data = []

for entry in data_unfiltered:
    new_entry = {
        "Name_EN": entry.get("Name_EN"),
        "Name_FR": entry.get("Name_FR"),
        "Types": entry.get("Types"),
        "Sprite": entry.get("Sprite")
    }
    data.append(new_entry)

# Sauvegarder dans pokes.json
with open("pokes.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Fichier pokes.json généré avec succès.")
