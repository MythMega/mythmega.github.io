import json

# Charger le fichier d'origine
with open("raw_data.json", "r", encoding="utf-8") as f:
  data = json.load(f)

# Récupérer la série et construire le nouvel index
serie = data.get("Serie", "")
new_index = f"SERIE-{serie} / "

# Mettre à jour l'index de chaque carte
for card in data.get("Cards", []):
  card["Index"] = new_index

# Sauvegarder le résultat dans data.json
with open("data.json", "w", encoding="utf-8") as f:
  json.dump(data, f, ensure_ascii=False, indent=2)

print("Le fichier data.json a été généré avec succès !")