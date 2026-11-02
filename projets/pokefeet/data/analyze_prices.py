import poke_data

# Charger le catalogue (éclaté dans data/cosmetics/)
cosmetics = poke_data.load('cosmetics')

total_backgrounds = 0
total_buttons = 0

# Parcourir chaque élément pour sommer les prix
for item in cosmetics:
    # On récupère le prix (s'il existe, sinon 0)
    price = item.get('Price', 0)
    item_type = item.get('Type')

    if item_type == 'Background':
        total_backgrounds += price
    elif item_type == 'Background-Buttons':
        total_buttons += price

# Calcul du total général
grand_total = total_backgrounds + total_buttons

# Affichage des résultats
print(f"Coût total des Backgrounds : {total_backgrounds}")
print(f"Coût total des Boutons : {total_buttons}")
print("-" * 30)
print(f"Total général (Backgrounds + Boutons) : {grand_total}")