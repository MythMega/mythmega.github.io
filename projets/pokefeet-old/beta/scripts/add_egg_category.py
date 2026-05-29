"""
Merge EggGroups and Category from a CSV into data/pokemons.json.
CSV format (header): Index,EggGroups,Category
- Index: numeric index matching pokemons.json entries
- EggGroups: semicolon- or comma-separated list (will be kept as an array)
- Category: short string

This script creates a backup `data/pokemons.json.bak` before writing.
"""
import json
import csv
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / 'data'
POKE_JSON = DATA / 'pokemons.json'
CSV_FILE = DATA / 'egg_category.csv'

if not POKE_JSON.exists():
    print(f"Cannot find {POKE_JSON}")
    raise SystemExit(1)
if not CSV_FILE.exists():
    print(f"Cannot find {CSV_FILE}. Create it with columns Index,EggGroups,Category")
    raise SystemExit(1)

with open(POKE_JSON, 'r', encoding='utf-8') as f:
    pokes = json.load(f)

# build index->entry map (only numeric indexes)
    pmap = {}
    for p in pokes:
        idx_raw = p.get('Index')
        try:
            idx = int(idx_raw)
        except Exception:
            # skip non-numeric entries like '19-B'
            continue
        pmap[idx] = p

updates = 0
with open(CSV_FILE, newline='', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        if not row.get('Index'):
            continue
        idx = int(row['Index'])
        if idx not in pmap:
            print(f"Index {idx} not found in pokemons.json, skipping")
            continue
        entry = pmap[idx]
        eg = row.get('EggGroups') or ''
        # split on semicolon or comma
        if eg:
            parts = [x.strip() for x in eg.replace(';', ',').split(',') if x.strip()]
            entry['EggGroups'] = parts
        cat = row.get('Category') or ''
        if cat:
            entry['Category'] = cat.strip()
        updates += 1

if updates == 0:
    print('No updates found in CSV.')
    raise SystemExit(0)

# backup
bak = POKE_JSON.with_suffix('.json.bak')
print(f'Backing up {POKE_JSON} -> {bak}')
POKE_JSON.replace(bak)

# write updated file
with open(POKE_JSON, 'w', encoding='utf-8') as f:
    json.dump(pokes, f, ensure_ascii=False, indent=2)

print(f'Updated {updates} entries in {POKE_JSON}')
