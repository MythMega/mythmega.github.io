import json
import os

# Charger le fichier data.json
data_file = os.path.join(os.path.dirname(__file__), 'data.json')

with open(data_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Parcourir chaque famille et chaque pokémon
for family in data:
    for member in family['Members']:
        index = member['Index']
        name_en = member['Name_EN'].lower()  # Convertir en minuscules pour les URLs
        
        # Ajouter les propriétés de sprites après "Sprite"
        if 'Sprite' in member:
            # Créer un dictionnaire temporaire pour réordonner les clés
            new_member = {}
            for key, value in member.items():
                new_member[key] = value
                if key == 'Sprite':
                    # Ajouter les nouvelles propriétés après Sprite
                    new_member['Sprite_Shiny'] = f"https://s3.pokeos.com/pokeos-uploads/assets/pokemon/home/render/shiny/{index}.png"
                    new_member['Sprite_BW'] = f"https://img.pokemondb.net/sprites/black-white/normal/{name_en}.png"
                    new_member['Sprite_BW_shiny'] = f"https://img.pokemondb.net/sprites/black-white/shiny/{name_en}.png"
                    new_member['Sprite_BW2'] = f"https://img.pokemondb.net/sprites/black-white/anim/normal/{name_en}.gif"
                    new_member['Sprite_BW2_shiny'] = f"https://img.pokemondb.net/sprites/black-white/anim/shiny/{name_en}.gif"
            
            # Remplacer le membre original
            family['Members'][family['Members'].index(member)] = new_member

# Sauvegarder le fichier modifié
with open(data_file, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print(f"✓ Script terminé! {len(data)} familles de pokémon ont été mises à jour.")
