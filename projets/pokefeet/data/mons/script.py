import json
import os
import shutil


def enrich_mega_pokemons(
    pokemons_path="pokemons.json", mega_path="mega.json", backup_path="mega.json.d"
):
  # 1. Copier mega.json vers mega.json.d pour faire une backup
  if os.path.exists(mega_path):
    shutil.copy(mega_path, backup_path)
    print(f"Sauvegarde créée avec succès : {backup_path}")
  else:
    print(f"Erreur : Le fichier {mega_path} est introuvable.")
    return

  # 2. Charger les fichiers JSON
  with open(pokemons_path, "r", encoding="utf-8") as f:
    pokemons = json.load(f)

  with open(mega_path, "r", encoding="utf-8") as f:
    megas = json.load(f)

  # Créer un dictionnaire pour retrouver facilement un Pokémon de base par son Index
  pokemon_dict = {p["Index"]: p for p in pokemons}

  # Champs autorisés à être hérités si null dans le mega
  fields_to_inherit = ["Type1", "Type2", "Category", "EggGroups"]

  # 3. Traiter chaque méga-évolution
  for mega in megas:
    mega_index = mega["Index"]
    # Extrait l'index de base (ex: "3-M" -> "3", "6-M-X" -> "6")
    base_index = mega_index.split("-")[0]

    base_poke = pokemon_dict.get(base_index)

    if base_poke:
      # Ajouter la propriété evolve_from
      mega["evolve_from"] = base_poke["Index"]

      # Gestion spécifique du nom anglais (si null, on ajoute "Mega-" devant)
      if mega.get("NameEN") is None and base_poke.get("NameEN") is not None:
        mega["NameEN"] = f"Mega-{base_poke['NameEN']}"

      # Remplir uniquement les valeurs nulles pour les champs spécifiés
      for field in fields_to_inherit:
        if mega.get(field) is None and base_poke.get(field) is not None:
          mega[field] = base_poke[field]
    else:
      print(
          f"Avertissement : Aucun Pokémon de base trouvé pour l'index"
          f" {base_index} (Méga: {mega_index})"
      )

  # 4. Sauvegarder les modifications dans le fichier mega.json d'origine
  with open(mega_path, "w", encoding="utf-8") as f:
    json.dump(megas, f, ensure_ascii=False, indent=2)

  print("Mise à jour de mega.json terminée avec succès !")


if __name__ == "__main__":
  enrich_mega_pokemons()