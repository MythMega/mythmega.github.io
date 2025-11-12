import csv
import json
import os

# Fonction pour transformer un fichier CSV en JSON avec les champs spécifiés
def convert_csv_to_json(csv_filename):
    json_filename = os.path.splitext(csv_filename)[0] + '.json'
    data = []

    with open(csv_filename, newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            entry = {
                "Index": row["#"],  # Sauvegardé en string
                "Name": row["Name"],
                "Generation": int(row["Generation"]),
                "Type1": row["Type 1"],
                "Type2": row["Type 2"] if row["Type 2"] else None,
                "Legendary": row["Legendary"].strip().lower() == "true"
            }
            data.append(entry)

    with open(json_filename, 'w', encoding='utf-8') as jsonfile:
        json.dump(data, jsonfile, indent=2, ensure_ascii=False)

# Parcours de tous les fichiers CSV dans le répertoire courant
for filename in os.listdir('.'):
    if filename.lower().endswith('.csv'):
        convert_csv_to_json(filename)
