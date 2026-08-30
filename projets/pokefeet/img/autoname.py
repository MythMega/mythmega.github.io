import os

# dossier contenant les images
folder = "."

# point de départ
num = 494

# récupérer tous les fichiers du dossier
files = os.listdir(folder)

# filtrer uniquement les images PNG
png_files = [f for f in files if f.lower().endswith(".png")]

# trier par ordre alphabétique
png_files.sort()

# renommer chaque fichier
for f in png_files:
    old_path = os.path.join(folder, f)
    new_name = f"{num}-a.png"
    new_path = os.path.join(folder, new_name)

    os.rename(old_path, new_path)
    print(f"Renommé : {f} → {new_name}")

    num += 1
