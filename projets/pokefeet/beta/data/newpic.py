import json
import os
import shutil
import requests
import re

INPUT_FILE = "pokemons.json.bak"
OUTPUT_FILE = "pokemons.json"
IMG_DIR = "../img/fullsprite/"

os.makedirs(IMG_DIR, exist_ok=True)

# Lecture du JSON source
with open(INPUT_FILE, "r", encoding="utf-8") as f:
    pokemons = json.load(f)

# Renommage du fichier
shutil.move(INPUT_FILE, OUTPUT_FILE)

# Formes régionales reconnues
REGIONAL_PREFIXES = {
    "Alolan": "alolan",
    "Galarian": "galarian",
    "Hisuian": "hisuian",
    "Paldean": "paldean"
}

def normalize_name(name):
    """Convertit un nom anglais en format URL pokemondb."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def extract_regional_form(name_en):
    """
    Détecte si le nom contient un préfixe régional.
    Exemple : 'Hisuian Typhlosion' → ('typhlosion', 'hisuian')
    """
    parts = name_en.split()
    if len(parts) > 1 and parts[0] in REGIONAL_PREFIXES:
        prefix = REGIONAL_PREFIXES[parts[0]]
        base_name = " ".join(parts[1:])
        return normalize_name(base_name), prefix
    return normalize_name(name_en), None

def handle_gender_forms(name_en):
    """
    Gère les cas 'Nidoran Male' / 'Nidoran Female'.
    Retourne une liste de variantes possibles.
    """
    if " Male" in name_en or " Female" in name_en:
        base = normalize_name(name_en.replace(" Male", "").replace(" Female", ""))
        return [base, f"{base}-m", f"{base}-f"]
    return None

def build_name_variants(name_en):
    """
    Retourne toutes les variantes possibles du nom pour tester les URLs.
    """
    # Cas spécial : Male / Female
    gender_variants = handle_gender_forms(name_en)
    if gender_variants:
        return gender_variants

    # Cas régional
    base, regional = extract_regional_form(name_en)
    if regional:
        return [f"{base}-{regional}"]

    # Cas normal
    return [base]

def download_image(name_en, index):
    """
    Télécharge l'image en testant toutes les variantes possibles.
    Retourne True si OK, False sinon.
    """
    base_url = "https://img.pokemondb.net/sprites/home/normal/"
    name_variants = build_name_variants(name_en)

    urls = []
    for name in name_variants:
        urls.append(f"{base_url}{name}.png")
        urls.append(f"{base_url}{name}-f.png")
        urls.append(f"{base_url}{name}-d.png")

    for url in urls:
        try:
            r = requests.get(url, timeout=5)
            if r.status_code == 200:
                out_path = os.path.join(IMG_DIR, f"{index}.png")
                with open(out_path, "wb") as img_file:
                    img_file.write(r.content)
                print(f"[OK] {name_en} → {url}")
                return True
        except:
            pass

    print(f"[FAIL] Aucune image trouvée pour {name_en}")
    return False


missing = []  # Liste des Pokémon sans image

# Traitement principal
for p in pokemons:
    index = p["Index"]
    name_en = p["NameEN"]

    ok = download_image(name_en, index)

    if not ok:
        missing.append((index, name_en))

    # Mise à jour du chemin dans le JSON
    p["FullImage"] = f"./img/fullsprite/{index}.png"

# Écriture du JSON final
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(pokemons, f, indent=2, ensure_ascii=False)

print("\n=== Pokémon sans image trouvée ===")
for idx, name in missing:
    print(f"{idx} - {name}")

print("\n✔ Script terminé.")
