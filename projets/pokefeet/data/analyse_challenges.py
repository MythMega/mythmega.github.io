import json
from collections import defaultdict

# --- Chargement des fichiers JSON ---
with open("bonus_challenges.json", "r", encoding="utf-8") as f:
    challenges = json.load(f)

with open("pokemons.json", "r", encoding="utf-8") as f:
    pokemons = json.load(f)

# --- Indexation des pokémons par leur numéro ---
pokemon_by_index = {p["Index"]: p for p in pokemons}

total_pokemon_count = len(pokemons)
total_challenges = len(challenges)

# --- Analyse des challenges ---
pokemon_challenge_count = defaultdict(int)
pokemon_challenge_names = defaultdict(list)

challenge_reports = []

for ch in challenges:
    ch_name = ch["Name_Fr"]
    feet_list = ch["FeetList"]

    missing = []
    for idx in feet_list:
        if idx in pokemon_by_index:
            pokemon_challenge_count[idx] += 1
            pokemon_challenge_names[idx].append(ch_name)
        else:
            missing.append(idx)

    challenge_reports.append({
        "id": ch["ID"],
        "name": ch_name,
        "missing": missing,
        "feet_count": len(feet_list)
    })

# --- Fonction de tri robuste pour les index ---
def safe_sort_key(s):
    num = ""
    for c in s:
        if c.isdigit():
            num += c
        else:
            break
    return (int(num) if num else float("inf"), s)

# --- Catégories ---
present_pokemon = sorted(pokemon_challenge_count.keys(), key=safe_sort_key)
overrepresented = sorted(
    [idx for idx, count in pokemon_challenge_count.items() if count >= 2],
    key=safe_sort_key
)
absent_pokemon = sorted(
    [p["Index"] for p in pokemons if p["Index"] not in pokemon_challenge_count],
    key=safe_sort_key
)

# --- Synthèse globale ---
count_present = len(present_pokemon)
count_overrepresented = len(overrepresented)
count_absent = len(absent_pokemon)

# --- Génération du fichier résultat ---
with open("result_analyse_challenge.log", "w", encoding="utf-8") as out:

    out.write("===== ANALYSE DES CHALLENGES =====\n\n")
    out.write(f"Nombre total de Pokémon : {total_pokemon_count}\n")
    out.write(f"Nombre total de challenges : {total_challenges}\n\n")

    out.write("===== SYNTHÈSE GLOBALE =====\n")
    out.write(f"Pokémon présents dans ≥1 challenge : {count_present} / {total_pokemon_count}\n")
    out.write(f"Pokémon surreprésentés (≥2 challenges) : {count_overrepresented} / {total_pokemon_count}\n")
    out.write(f"Pokémon absents (0 challenge) : {count_absent} / {total_pokemon_count}\n\n")

    out.write("----- Vérification des challenges -----\n")
    for rep in challenge_reports:
        out.write(f"\nChallenge {rep['id']} - {rep['name']}\n")
        out.write(f"  Nombre de Pokémon listés : {rep['feet_count']}\n")
        if rep["missing"]:
            out.write("  ⚠️ Index manquants : " + ", ".join(rep["missing"]) + "\n")
        else:
            out.write("  ✓ Tous les index correspondent à un Pokémon.\n")

    out.write("\n\n----- Pokémon présents dans au moins un challenge -----\n")
    for idx in present_pokemon:
        p = pokemon_by_index[idx]
        out.write(f"{idx} - {p['NameFR']}\n")

    out.write("\n\n----- Pokémon surreprésentés (≥ 2 challenges) -----\n")
    if overrepresented:
        for idx in overrepresented:
            p = pokemon_by_index[idx]
            names = ", ".join(pokemon_challenge_names[idx])
            out.write(f"{idx} - {p['NameFR']} | Challenges : {names}\n")
    else:
        out.write("Aucun pokémon surreprésenté.\n")

    out.write("\n\n----- Pokémon absents de tous les challenges -----\n")
    for idx in absent_pokemon:
        p = pokemon_by_index[idx]
        out.write(f"{idx} - {p['NameFR']}\n")

print("Analyse terminée. Fichier result_analyse_challenge.log généré.")
