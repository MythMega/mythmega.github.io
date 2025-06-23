import re

# Ouvrir le fichier d'entrée
with open("text.txt", "r", encoding="utf-8") as fichier:
    contenu = fichier.read()

# Remplacer les tabulations et les retours à la ligne par des espaces
contenu_modifie = contenu.replace("\t", " ")

# Remplacer les multiples espaces par un seul espace
contenu_modifie = re.sub(r" +", " ", contenu_modifie)

# Sauvegarder le contenu modifié dans un nouveau fichier
with open("output.txt", "w", encoding="utf-8") as fichier_sortie:
    fichier_sortie.write(contenu_modifie)

print("Les indentations, retours à la ligne et espaces multiples ont été remplacés. Résultat sauvegardé dans 'output.txt'.")
