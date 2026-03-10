import json

with open("pokemons.json", "r", encoding="utf-8") as f:
    data = json.load(f)

egg_groups = set()

for pokemon in data:
    for group in pokemon.get("EggGroups", []):
        egg_groups.add(group)

print(egg_groups)
