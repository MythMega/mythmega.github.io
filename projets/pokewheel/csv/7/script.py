import csv
import json
import os

def convert_csv_to_json(csv_filename):
    json_filename = os.path.splitext(csv_filename)[0] + '.json'
    data = []

    with open(csv_filename, newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            entry = {
                "Index": row["pokedex_number"],
                "Name": row["name"],
                "Generation": int(row["generation"]),
                "Type1": row["type1"],
                "Type2": row["type2"] if row["type2"] else None,
                "Legendary": row["is_legendary"].strip().lower() == "true"
            }
            data.append(entry)

    with open(json_filename, 'w', encoding='utf-8') as jsonfile:
        json.dump(data, jsonfile, indent=2, ensure_ascii=False)

# Traitement de tous les fichiers CSV dans le répertoire courant
for filename in os.listdir('.'):
    if filename.lower().endswith('.csv'):
        convert_csv_to_json(filename)
