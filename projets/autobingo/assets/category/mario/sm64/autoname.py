#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
from pathlib import Path
from datetime import datetime
import uuid

# Configuration : adapter si nécessaire
PNG_EXT = ".png"
CAPTURE_REGEX = re.compile(r"^Capture d'écran (\d{4}-\d{2}-\d{2} \d{6})\.png$", re.IGNORECASE)
NUMERIC_REGEX = re.compile(r"^(\d+)\.png$")

def parse_capture_datetime(name: str):
    m = CAPTURE_REGEX.match(name)
    if not m:
        return None
    dt_str = m.group(1)  # ex: "2026-06-15 144352"
    try:
        # format: YYYY-MM-DD HHMMSS
        return datetime.strptime(dt_str, "%Y-%m-%d %H%M%S")
    except ValueError:
        return None

def main():
    cwd = Path.cwd()
    png_files = [p for p in cwd.iterdir() if p.is_file() and p.suffix.lower() == PNG_EXT]

    # 1) Trouver les fichiers numériques et déterminer le max
    numeric_files = []
    max_num = 0
    for p in png_files:
        m = NUMERIC_REGEX.match(p.name)
        if m:
            n = int(m.group(1))
            numeric_files.append((n, p))
            if n > max_num:
                max_num = n

    start_num = max_num + 1

    # 2) Trouver les captures et trier par datetime croissante
    capture_files = []
    for p in png_files:
        if NUMERIC_REGEX.match(p.name):
            continue
        dt = parse_capture_datetime(p.name)
        if dt is not None:
            capture_files.append((dt, p))
    capture_files.sort(key=lambda x: x[0])

    if not capture_files:
        print("Aucune capture au format attendu trouvée. Rien à renommer.")
        return

    # 3) Renommage en deux étapes pour éviter collisions :
    #    a) renommer chaque capture en un nom temporaire unique
    #    b) renommer les temporaires en noms finaux séquentiels
    temp_map = []  # tuples (temp_path, final_path)

    for i, (_, p) in enumerate(capture_files):
        temp_name = f"__tmp_{uuid.uuid4().hex}.tmp"
        temp_path = p.with_name(temp_name)
        p.rename(temp_path)
        final_name = f"{start_num + i}.png"
        final_path = cwd / final_name
        temp_map.append((temp_path, final_path))

    # 4) Effectuer les renommages finaux
    for temp_path, final_path in temp_map:
        if final_path.exists():
            # En théorie cela ne devrait pas arriver car on a calculé start_num,
            # mais on gère le cas par sécurité : on incrémente jusqu'à trouver un nom libre.
            n = int(final_path.stem) if final_path.stem.isdigit() else None
            candidate = final_path
            while candidate.exists():
                if n is None:
                    # si final_path n'est pas numérique, on ajoute un suffixe
                    candidate = final_path.with_name(final_path.stem + "_1" + final_path.suffix)
                else:
                    n += 1
                    candidate = final_path.with_name(f"{n}.png")
            final_path = candidate
        temp_path.rename(final_path)
        print(f"Renommé : {temp_path.name} -> {final_path.name}")

    print(f"Terminé. Les captures ont été renommées à partir de {start_num}.")
    return

if __name__ == "__main__":
    main()
