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
                "Index": row["No."],
                "Name": row["Name"],
                "Generation": 8,
                "Type1": row["Type1"],
                "Type2": row["Type2"] if row["Type2"] else None,
                "Legendary": False
            }
            data.append(entry)

    with open(json_filename, 'w', encoding='utf-8') as jsonfile:
        json.dump(data, jsonfile, indent=2, ensure_ascii=False)

# Traitement de tous les fichiers CSV dans le répertoire courant
for filename in os.listdir('.'):
    if filename.lower().endswith('.csv'):
        convert_csv_to_json(filename)
