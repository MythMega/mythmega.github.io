"""
Fetch egg groups and French genus (category) for Pokémon 1..151 from PokeAPI.
Writes `data/egg_category.csv` with header Index,EggGroups,Category
"""
import json
import time
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from pathlib import Path
import csv

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / 'data'
OUT = DATA / 'egg_category.csv'
POKEAPI = 'https://pokeapi.co/api/v2/pokemon-species/{}'

# optional small translation mapping (english -> french) for common egg-groups
EGG_TRANSLATIONS = {
    'monster': "Monstrueux",
    'water-1': "Eau 1",
    'water-2': "Eau 2",
    'water-3': "Eau 3",
    'water1': "Eau 1",
    'water2': "Eau 2",
    'water3': "Eau 3",
    'bug': "Insecte",
    'flying': "Vol",
    'ground': "Sol",
    'fairy': "Fée",
    'plant': "Végétal",
    'grass': "Végétal",
    'humanshape': "Humanoïde",
    'human-like': "Humanoïde",
    'mineral': "Minéral",
    'no-eggs': "Sans oeufs",
    'ditto': "Ditto",
    'dragon': "Dragon",
    'indeterminate': "Indéterminé"
}

rows = []
errors = []

for i in range(1, 152):
    url = POKEAPI.format(i)
    try:
        req = Request(url, headers={"User-Agent": "pokefeet-fetcher/1.0"})
        with urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except HTTPError as e:
        errors.append(f"{i}: HTTP {e.code}")
        time.sleep(0.5)
        continue
    except URLError as e:
        errors.append(f"{i}: URL error {e}")
        time.sleep(1)
        continue
    except Exception as e:
        errors.append(f"{i}: other error {e}")
        time.sleep(1)
        continue

    # egg groups
    egg_groups = data.get('egg_groups', [])
    eg_names = [eg.get('name', '') for eg in egg_groups]
    # translate where possible
    eg_trans = [EGG_TRANSLATIONS.get(n, n) for n in eg_names]
    eg_field = ';'.join(eg_trans)

    # genus (genera) – try french
    genus = ''
    for g in data.get('genera', []):
        lang = g.get('language', {}).get('name')
        if lang == 'fr':
            genus = g.get('genus', '')
            break
    if not genus:
        # fallback to any genus
        if data.get('genera'):
            genus = data['genera'][0].get('genus', '')

    # ensure no newlines and wrap category in quotes if contains comma
    if ',' in genus:
        genus = '"' + genus.replace('"', '""') + '"'

    rows.append((str(i), eg_field, genus))
    # be polite
    time.sleep(0.3)

# write CSV
DATA.mkdir(parents=True, exist_ok=True)
with open(OUT, 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Index', 'EggGroups', 'Category'])
    for r in rows:
        w.writerow(r)

print(f'Wrote {len(rows)} lines to {OUT}')
if errors:
    print('Errors:')
    for e in errors:
        print(e)
