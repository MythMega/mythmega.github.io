#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from collections import defaultdict

INPUT_CSV = "data.csv"
OUTPUT_JSON = "data.json"
START_ROW = 7  # première ligne à utiliser pour B/C/D/E

def cell(col, row):
    return f"{col}{row}"

def build_onedit_entries(rows):
    groups = defaultdict(list)
    for r in rows:
        groups[r['Game']].append(r)

    onedit = []
    for game, items in groups.items():
        cells_values = []
        for i, item in enumerate(items):
            row_num = START_ROW + i

            cells_values.append({"Cell": cell("B", row_num), "Value": item.get("Badge Name", "")})
            cells_values.append({"Cell": cell("C", row_num), "Value": item.get("Location", "")})
            cells_values.append({"Cell": cell("D", row_num), "Value": item.get("Champion", "")})
            cells_values.append({"Cell": cell("E", row_num), "Value": item.get("url", "")})

        onedit.append({
            "CellContent": game,
            "CellsValues": cells_values
        })

    return onedit

def read_csv(path):
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = [{k: v.strip() for k, v in row.items()} for row in reader]
    return rows

def main():
    rows = read_csv(INPUT_CSV)
    onedit = build_onedit_entries(rows)

    output = {
        "CellToCheck": "B3",
        "CellCheckResult": "C3",
        "OnEdit": onedit
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Fichier '{OUTPUT_JSON}' généré avec {len(onedit)} entrées OnEdit.")

if __name__ == "__main__":
    main()
