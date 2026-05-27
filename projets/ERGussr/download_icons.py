#!/usr/bin/env python3
# coding: utf-8
# pour update : python download_icons.py --mode update
"""
download_icons_multi.py
Lit plusieurs fichiers JSON (constante JSON_FILES) et télécharge les icônes depuis eldenring.fandom.com.
Mode 'update' (par défaut) ou 'replace'.
"""

import os
import json
import time
import re
import argparse
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# -------------------- CONFIG (modifiable) --------------------
# Liste de fichiers JSON à traiter par défaut
JSON_FILES = [
    "./data/Dataset-weapon.json",
    "./data/Dataset-armors.json",
    "./data/Dataset-accessories.json",
    "./data/Dataset-goods.json"
]

BASE_WIKI = "https://eldenring.fandom.com/wiki/"
API_ENDPOINT = "https://eldenring.fandom.com/api.php"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://eldenring.fandom.com/",
}
REQUEST_TIMEOUT = 15
SLEEP_BETWEEN_REQUESTS = 0.25
MAX_RETRIES = 2
# ------------------------------------------------------------

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def ensure_dir_for_file(path):
    d = os.path.dirname(path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

def sanitize_picture_path(picture_url):
    if picture_url.startswith("./") or not os.path.isabs(picture_url):
        return os.path.normpath(picture_url)
    return picture_url

def canonicalize_image_url(url):
    if not url:
        return url
    parts = re.split(r"/revision/", url, maxsplit=1)
    return parts[0]

def normalize_page_name(name_en):
    """
    Normalise le nom anglais pour construire le titre de page :
    - remplace les espaces par underscores
    - supprime les caractères () et []
    - remplace les séquences d'underscores multiples par un seul _
    - strip des underscores en début/fin
    """
    if not name_en:
        return ""
    s = name_en.replace(" ", "_")
    # supprimer uniquement les caractères parenthèses et crochets (garder le contenu)
    s = re.sub(r"[\(\)\[\]]", "", s)
    s = re.sub(r"_+", "_", s)
    s = s.strip("_")
    return s

def get_image_url_via_api(session, page_title):
    params = {
        "action": "query",
        "format": "json",
        "titles": page_title,
        "prop": "pageimages",
        "pithumbsize": "1000"
    }
    try:
        r = session.get(API_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        for pid, page in pages.items():
            thumb = page.get("thumbnail", {})
            if thumb and thumb.get("source"):
                return canonicalize_image_url(thumb.get("source"))
    except Exception:
        pass

    params = {
        "action": "query",
        "format": "json",
        "titles": page_title,
        "prop": "images",
        "imlimit": "max"
    }
    try:
        r = session.get(API_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        for pid, page in pages.items():
            images = page.get("images", [])
            if images:
                candidate = None
                for img in images:
                    title = img.get("title", "")
                    if "Icon" in title or "ER_Icon" in title or title.lower().endswith((".png", ".jpg", ".jpeg", ".gif")):
                        candidate = title
                        break
                if not candidate:
                    candidate = images[0].get("title")
                if candidate:
                    params2 = {
                        "action": "query",
                        "format": "json",
                        "titles": candidate,
                        "prop": "imageinfo",
                        "iiprop": "url"
                    }
                    r2 = session.get(API_ENDPOINT, params=params2, timeout=REQUEST_TIMEOUT)
                    r2.raise_for_status()
                    data2 = r2.json()
                    pages2 = data2.get("query", {}).get("pages", {})
                    for pid2, page2 in pages2.items():
                        ii = page2.get("imageinfo", [])
                        if ii and ii[0].get("url"):
                            return canonicalize_image_url(ii[0].get("url"))
    except Exception:
        pass

    return None

def find_image_url_from_html(session, page_url, name_en):
    try:
        r = session.get(page_url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception:
        return None

    selectors = [
        ".pi-image a img",
        ".portable-infobox .pi-image img",
        ".pi-image img",
        "figure.pi-image img",
        "img.pi-image-thumbnail"
    ]
    for sel in selectors:
        img_tag = soup.select_one(sel)
        if img_tag:
            for attr in ("src", "data-src", "data-image-src"):
                val = img_tag.get(attr)
                if val:
                    return canonicalize_image_url(val)
            srcset = img_tag.get("srcset")
            if srcset:
                first = srcset.split(",")[0].strip().split(" ")[0]
                if first:
                    return canonicalize_image_url(first)

    if name_en:
        name_lower = name_en.lower()
        for img_tag in soup.find_all("img"):
            alt = (img_tag.get("alt") or "").lower()
            if name_lower in alt:
                for attr in ("src", "data-src", "data-image-src"):
                    val = img_tag.get(attr)
                    if val:
                        return canonicalize_image_url(val)
                srcset = img_tag.get("srcset")
                if srcset:
                    first = srcset.split(",")[0].strip().split(" ")[0]
                    if first:
                        return canonicalize_image_url(first)

    return None

def download_binary(session, url):
    try:
        r = session.get(url, timeout=REQUEST_TIMEOUT, stream=True)
        r.raise_for_status()
        return r.content
    except Exception:
        return None

def download_image_for_item(name_en, picture_path, session):
    page_name = normalize_page_name(name_en)
    page_name = quote(page_name, safe="_()")
    page_url = urljoin(BASE_WIKI, page_name)

    img_url = get_image_url_via_api(session, page_name)
    if img_url:
        if img_url.startswith("//"):
            img_url = "https:" + img_url
        elif img_url.startswith("/"):
            parsed = urlparse(BASE_WIKI)
            img_url = f"{parsed.scheme}://{parsed.netloc}{img_url}"
    else:
        img_url = find_image_url_from_html(session, page_url, name_en)

    if not img_url:
        print(f"  ! Icône introuvable pour la page {page_url}")
        return False

    img_bytes = None
    for attempt in range(MAX_RETRIES + 1):
        img_bytes = download_binary(session, img_url)
        if img_bytes:
            break
        if attempt < MAX_RETRIES:
            session.headers["Referer"] = page_url
            time.sleep(0.5 + attempt * 0.5)

    if not img_bytes:
        print(f"  ! Échec téléchargement image depuis {img_url}")
        return False

    ensure_dir_for_file(picture_path)
    try:
        with open(picture_path, "wb") as f:
            f.write(img_bytes)
    except Exception as e:
        print(f"  ! Erreur écriture fichier {picture_path}: {e}")
        return False

    return True

def parse_args():
    p = argparse.ArgumentParser(description="Télécharge icônes Elden Ring depuis le wiki (multi-JSON, mode update/replace).")
    p.add_argument("--mode", choices=["update", "replace"], default="update",
                   help="update = skip existing files (par défaut); replace = retélécharge et remplace")
    p.add_argument("--jsons", default=None,
                   help="Liste de fichiers JSON séparés par des virgules pour surcharger JSON_FILES (optionnel).")
    return p.parse_args()

def main():
    args = parse_args()
    mode = args.mode

    json_files = JSON_FILES.copy()
    if args.jsons:
        json_files = [p.strip() for p in args.jsons.split(",") if p.strip()]

    total_entries = 0
    downloaded = 0
    skipped = 0
    failed = 0

    session = requests.Session()
    session.headers.update(HEADERS)

    for json_file in json_files:
        if not os.path.exists(json_file):
            print(f"Fichier JSON introuvable : {json_file} — skip")
            continue

        try:
            data = load_json(json_file)
        except Exception as e:
            print(f"Erreur lecture JSON '{json_file}': {e}")
            continue

        total = len(data)
        total_entries += total
        print(f"\nTraitement de {json_file} : {total} entrées. Mode : {mode}")

        for idx, entry in enumerate(data, start=1):
            name_en = entry.get("NameEN") or entry.get("Name")
            picture_url_field = entry.get("PictureURL") or entry.get("PictureUrl") or entry.get("Picture")

            if not name_en or not picture_url_field:
                print(f"[{idx}/{total}] Ignoré (données manquantes).")
                failed += 1
                continue

            dest_path = sanitize_picture_path(picture_url_field)
            dest_file = dest_path
            if dest_file.endswith(os.sep) or not os.path.splitext(dest_file)[1]:
                safe_name = re.sub(r"[^\w\-_. ]", "_", name_en).strip().replace(" ", "_")
                dest_file = os.path.join(dest_file, f"{safe_name}.png")

            if os.path.exists(dest_file) and mode == "update":
                print(f"[{idx}/{total}] {name_en} -> {dest_file} ... SKIPPED (exists)")
                skipped += 1
                continue

            print(f"[{idx}/{total}] {name_en} -> {dest_file} ...", end=" ", flush=True)

            success = download_image_for_item(name_en, dest_file, session)
            if success:
                downloaded += 1
                print("OK")
            else:
                failed += 1
                print("FAILED")

            time.sleep(SLEEP_BETWEEN_REQUESTS)

    print("\n=== Résumé global ===")
    print(f"Total d'entrées traitées : {total_entries}")
    print(f"Images téléchargées : {downloaded}")
    print(f"Skippées (existantes) : {skipped}")
    print(f"Échecs : {failed}")

if __name__ == "__main__":
    main()
