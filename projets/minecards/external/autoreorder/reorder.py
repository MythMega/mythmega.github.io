import json

# 1. Chargement des fichiers
with open("order.json", "r", encoding="utf-8") as f:
    order_data = json.load(f)

with open("results.json", "r", encoding="utf-8") as f:
    results_data = json.load(f)

# 2. Indexation des cartes de results.json
cards_by_index = {}
cards_list = results_data.get("Cards", [])

for card in cards_list:
    idx = str(card.get("Index", "")).strip()
    if idx:
        cards_by_index.setdefault(idx, []).append(card)

print(f"--- Diagnostic ---")
print(f"Nombre total de cartes dans results.json : {len(cards_list)}")
print(f"Exemples de clés dans results.json : {list(cards_by_index.keys())[:3]}")

# 3. Normalisation de la liste d'ordre (gestion des divers formats de order.json)
if isinstance(order_data, dict):
    # Si order.json est un dictionnaire, on extrait la première liste trouvée
    order_list = next((v for v in order_data.values() if isinstance(v, list)), [])
else:
    order_list = order_data

print(f"Nombre d'éléments dans order.json : {len(order_list)}")

# 4. Reconstruction de la liste ordonnée
ordered_cards = []
matches_count = 0

for item in order_list:
    # Si chaque élément est un dictionnaire (ex: {"Index": "ITEM-000097"})
    if isinstance(item, dict):
        idx = str(item.get("Index") or item.get("id") or "").strip()
    else:
        # Si chaque élément est une simple chaîne (ex: "ITEM-000097")
        idx = str(item).strip()

    if idx in cards_by_index:
        ordered_cards.extend(cards_by_index[idx])
        matches_count += 1

print(f"Nombre de correspondances trouvées : {matches_count}")

# 5. Sauvegarde
results_ordered = {
    "Serie": results_data.get("Serie"),
    "ImportMode": results_data.get("ImportMode"),
    "Cards": ordered_cards,
}

with open("results_ordered.json", "w", encoding="utf-8") as f:
    json.dump(results_ordered, f, ensure_ascii=False, indent=2)

print("Génération terminée -> results_ordered.json")