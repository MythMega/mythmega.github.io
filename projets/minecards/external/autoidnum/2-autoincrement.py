import json

# Charger les données
with open("data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Dictionnaires de suivi des compteurs et des numéros attribués par nom
group_counters = {}
name_to_number = {}

for card in data["Cards"]:
    raw_index = card["Index"].strip()
    # Récupérer la dernière lettre du groupe (ex: 'W' ou 'P')
    group_letter = raw_index[-1]
    name = card["Name_FR"]

    # Initialisation du groupe si absent
    if group_letter not in group_counters:
        group_counters[group_letter] = 1
        name_to_number[group_letter] = {}

    # Si la carte n'a pas encore de numéro attribué dans ce groupe
    if name not in name_to_number[group_letter]:
        formatted_num = f"{group_counters[group_letter]:03d}"
        name_to_number[group_letter][name] = formatted_num
        group_counters[group_letter] += 1
    else:
        formatted_num = name_to_number[group_letter][name]

    # Mise à jour de l'Index
    card["Index"] = f"{raw_index}{formatted_num}"

# Sauvegarder le résultat
with open("output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)