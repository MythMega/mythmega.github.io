import poke_data

# Charger le catalogue d'origine (éclaté dans data/cosmetics/)
cosmetics = poke_data.load('cosmetics')

# Dictionnaire pour stocker le nom de fichier des backgrounds (ID -> File)
background_files = {}

# Première passe : Traiter les Backgrounds (ID >= 2000)
for item in cosmetics:
    if item.get('ID', 0) >= 2000 and item.get('Type') == 'Background':
        value = item.get('Value', '')
        # Retirer "creative-" et ajouter ".png"
        file_name = value.replace('creative-', '') + '.png'
        item['File'] = file_name
        # On mémorise le fichier associé à cet ID de background
        background_files[item['ID']] = file_name

# Deuxième passe : Traiter les Background-Buttons (ID correspondant = ID du background + 100)
for item in cosmetics:
    if item.get('ID', 0) >= 2000 and item.get('Type') == 'Background-Buttons':
        bg_id = item['ID'] - 100  # Retrouver l'ID du background associé
        if bg_id in background_files:
            item['File'] = background_files[bg_id]

# Réécrire le découpage (data/cosmetics/*.json) et son manifeste
written = poke_data.write('cosmetics', cosmetics)

print("Mise à jour réussie ! %d fichiers réécrits dans data/cosmetics/." % len(written))