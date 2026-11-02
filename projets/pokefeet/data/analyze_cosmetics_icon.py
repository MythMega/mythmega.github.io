import os

import poke_data

# Charger le catalogue (éclaté dans data/cosmetics/)
cosmetics = poke_data.load('cosmetics')

# Dossier cible à vérifier
target_dir = '../img/cosmetics'

# Récupérer tous les noms de fichiers distincts (en ignorant les None ou absents)
distinct_files = set()
for item in cosmetics:
    file_name = item.get('File')
    if file_name:
        distinct_files.add(file_name)

missing_files = []
existing_count = 0

print(f"Vérification de {len(distinct_files)} fichiers distincts dans '{target_dir}'...\n")

# Vérifier l'existence de chaque fichier
for file_name in sorted(distinct_files):
    file_path = os.path.join(target_dir, file_name)
    if os.path.isfile(file_path):
        existing_count += 1
    else:
        missing_files.append(file_name)

# Affichage du rapport
print("-" * 40)
print(f"Fichiers trouvés : {existing_count}")
print(f"Fichiers manquants : {len(missing_files)}")
print("-" * 40)

if missing_files:
    print("Liste des fichiers manquants :")
    for mf in missing_files:
        print(f"  - {mf}")
else:
    print("Tous les fichiers existent ! Aucun manquant.")