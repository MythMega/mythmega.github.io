#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wikiscrap_playwright_blocks_with_logs.py
Scrape English and French block lists from minecraft.wiki using Playwright,
open the file page for each sprite thumbnail to get the full-size image,
download images via browser fetch (to avoid 403), produce minecraft_full_block.json,
and write detailed logs to a file.
"""

import os
import re
import json
import time
import base64
import logging
from datetime import datetime
from urllib.parse import urljoin, urlparse, unquote

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

# --- Configuration ---
EN_URL = "https://minecraft.wiki/w/Block"
FR_URL = "https://fr.minecraft.wiki/w/Bloc"
OUTPUT_JSON = "minecraft_full_block.json"
ASSETS_DIR = os.path.join("assets", "category", "minecraft")
LOG_FILE = os.path.join(ASSETS_DIR, "scrape_blocks.log")
DELAY_BETWEEN_DOWNLOADS = 0.12
HEADLESS = True
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DOWNLOAD_RETRIES = 2
NAV_RETRIES = 2
TIMEOUT = 60000  # ms

os.makedirs(ASSETS_DIR, exist_ok=True)

# --- Logging setup (console + file) ---
logger = logging.getLogger("wikiscrap")
logger.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

# console handler
ch = logging.StreamHandler()
ch.setLevel(logging.INFO)
ch.setFormatter(formatter)
logger.addHandler(ch)

# file handler (append)
fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
fh.setLevel(logging.DEBUG)
fh.setFormatter(formatter)
logger.addHandler(fh)

logger.info("=== Starting wikiscrap_playwright_blocks_with_logs.py ===")

# --- Utilitaires ---
def sanitize_filename(name):
    name = name.strip().replace(" ", "_")
    name = re.sub(r'[<>:"/\\|?*\']', "", name)
    name = re.sub(r'__+', "_", name)
    return name[:200] or "item"

def normalize_sprite_filename_from_src(src_url):
    """
    Retourne le basename "réel" de l'image à partir d'une URL de miniature ou d'image.
    Gère les cas /images/thumb/<original>/<size-...>
    """
    if not src_url:
        return ""
    try:
        parsed = urlparse(src_url)
        path = parsed.path or ""
        if "/images/thumb/" in path:
            tail = path.split("/images/thumb/", 1)[1]
            original = tail.split("/", 1)[0]
            return unquote(original)
        base = os.path.basename(path)
        return unquote(base.split("?")[0])
    except Exception:
        return os.path.basename(src_url).split("?")[0]

def simplify_key(name):
    """
    Simplifie un nom de fichier pour appariement flou :
    - lowercase
    - supprime préfixes itemsprite_/blocksprite_
    - supprime suffixes _JE\d+ _BE\d+ et combinaisons
    - remplace tirets/espaces par underscore
    - supprime extension
    """
    if not name:
        return ""
    s = name.lower()
    # enlever query
    s = s.split("?", 1)[0]
    # enlever extension
    s = re.sub(r'\.(png|jpg|jpeg|gif)$', '', s)
    # enlever préfixes
    s = re.sub(r'^(itemsprite_|blocksprite_)', '', s)
    # enlever tags d'édition comme _je1, _je12, _be2, _je1_be2, etc.
    s = re.sub(r'(_je\d+(_be\d+)?)', '', s)
    s = re.sub(r'(_be\d+(_je\d+)?)', '', s)
    # enlever tailles "30px-" si présentes
    s = re.sub(r'^\d+px-', '', s)
    # enlever parenthèses et leur contenu
    s = re.sub(r'\(.*?\)', '', s)
    # normaliser séparateurs
    s = re.sub(r'[\s\-]+', '_', s)
    s = re.sub(r'__+', '_', s)
    s = s.strip('_')
    return s

def extract_items_from_html_filtered(html, base_url):
    """
    Parse HTML and return list of dicts:
    { 'name': <title from link>, 'thumb_src': <thumb src absolute>, 'img_file': <basename>, 'file_page': <absolute href to file page or None> }
    Only consider <li> that are inside <ul> inside <div class="div-col columns column-width">.
    """
    soup = BeautifulSoup(html, "html.parser")
    items = []

    divs = soup.find_all("div", class_="div-col columns column-width")
    for div in divs:
        for ul in div.find_all("ul"):
            for li in ul.find_all("li"):
                # For blocks the thumbnail is often wrapped in <a class="mw-file-description"> or <span typeof="mw:File">
                file_a = li.find("a", class_="mw-file-description")
                if not file_a:
                    for a in li.find_all("a", href=True):
                        if a["href"].startswith("/w/File:") or "File:" in a.get("href", ""):
                            file_a = a
                            break

                img_tag = li.find("img")
                a_tag = li.find("a", title=True)
                span_text = li.find("span", class_="sprite-text")

                if img_tag and (a_tag or span_text):
                    name = (a_tag.get("title") if a_tag else None) or (span_text.get_text(strip=True) if span_text else "")
                    src = img_tag.get("src") or img_tag.get("data-src") or ""
                    src_abs = urljoin(base_url, src) if src else None
                    filename = normalize_sprite_filename_from_src(src_abs) if src_abs else ""
                    file_page = None
                    if file_a and file_a.get("href"):
                        file_page = urljoin(base_url, file_a.get("href"))
                    items.append({
                        "name": name.strip(),
                        "thumb_src": src_abs,
                        "img_file": filename,
                        "file_page": file_page
                    })
    return items

# --- Navigate to file page and extract full image src ---
def get_full_image_src_from_filepage(page, file_page_url, timeout=30000):
    """
    Navigate to the file page and try multiple selectors to find the full-size image src.
    Returns absolute or relative src string or None.
    """
    if not file_page_url:
        return None
    for attempt in range(1, NAV_RETRIES + 1):
        try:
            page.goto(file_page_url, wait_until="networkidle", timeout=timeout)
            selectors = ["img.png", "div.fullMedia img", "figure img", ".mw-filepage-image img", ".fullImageLink img", "a.internal img"]
            for sel in selectors:
                try:
                    el = page.query_selector(sel)
                    if el:
                        src = el.get_attribute("src")
                        if src:
                            return src
                except Exception:
                    continue
            imgs = page.query_selector_all("img")
            for im in imgs:
                try:
                    src = im.get_attribute("src")
                    if src and src.startswith("http"):
                        return src
                except Exception:
                    continue
            anchors = page.query_selector_all("a")
            for a in anchors:
                try:
                    href = a.get_attribute("href")
                    if href and (href.endswith(".png") or href.endswith(".jpg") or href.endswith(".gif")) and href.startswith("http"):
                        return href
                except Exception:
                    continue
            return None
        except Exception as e:
            logger.debug(f"get_full_image_src_from_filepage attempt {attempt} failed: {e}")
            time.sleep(0.5)
    return None

# --- Download via page (browser fetch) with fallback to requests ---
def download_image_via_page(page, img_url, dest_path, referer=None, timeout=30000):
    """
    Use page.evaluate to fetch the image in the browser and write to dest_path.
    Fallback to requests if browser fetch fails.
    """
    if not img_url:
        return False
    try:
        parsed = urlparse(img_url)
        if not parsed.scheme:
            img_url = urljoin(EN_URL, img_url)
    except Exception:
        pass

    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            if referer:
                try:
                    page.goto(referer, wait_until="networkidle", timeout=timeout)
                except Exception:
                    pass

            js = """
            async (url) => {
                try {
                    const resp = await fetch(url, { credentials: 'same-origin' });
                    if (!resp.ok) {
                        return { ok: false, status: resp.status };
                    }
                    const buf = await resp.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunk) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                    }
                    return { ok: true, b64: btoa(binary) };
                } catch (e) {
                    return { ok: false, error: String(e) };
                }
            }
            """
            result = page.evaluate(js, img_url)
            if isinstance(result, dict) and result.get("ok"):
                b64 = result.get("b64")
                with open(dest_path, "wb") as f:
                    f.write(base64.b64decode(b64))
                return True
            else:
                status = result.get("status") if isinstance(result, dict) else None
                err = result.get("error") if isinstance(result, dict) else None
                logger.debug(f"Browser fetch failed (attempt {attempt}) for {img_url} status={status} error={err}")
        except Exception as e:
            logger.debug(f"download_image_via_page exception (attempt {attempt}): {e}")

        time.sleep(0.3)

    # Fallback to requests
    try:
        import requests
        headers = {"User-Agent": USER_AGENT}
        if referer:
            headers["Referer"] = referer
        r = requests.get(img_url, stream=True, timeout=30, headers=headers)
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(8192):
                if chunk:
                    f.write(chunk)
        return True
    except Exception as e:
        logger.debug(f"Fallback requests download failed for {img_url}: {e}")
        return False

# --- Main ---
def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()

        logger.info("Loading English page...")
        page.goto(EN_URL, wait_until="networkidle", timeout=TIMEOUT)
        en_html = page.content()

        logger.info("Loading French page...")
        page.goto(FR_URL, wait_until="networkidle", timeout=TIMEOUT)
        fr_html = page.content()

        logger.info("Parsing English items (filtered)...")
        en_items = extract_items_from_html_filtered(en_html, EN_URL)
        logger.info(f"  Found {len(en_items)} EN candidates inside div-col lists.")

        logger.info("Parsing French items (filtered)...")
        fr_items = extract_items_from_html_filtered(fr_html, FR_URL)
        logger.info(f"  Found {len(fr_items)} FR candidates inside div-col lists.")

        # Build maps by normalized simplified key (fuzzy)
        en_map = {}
        for it in en_items:
            raw = it.get("img_file") or ""
            key = simplify_key(raw)
            if not key:
                continue
            en_map.setdefault(key, []).append(it)

        fr_map = {}
        for it in fr_items:
            raw = it.get("img_file") or ""
            key = simplify_key(raw)
            if not key:
                continue
            fr_map.setdefault(key, []).append(it)

        logger.info(f"  EN simplified keys: {len(en_map)}")
        logger.info(f"  FR simplified keys: {len(fr_map)}")

        # Intersection of simplified keys
        common_keys = sorted(k for k in en_map.keys() & fr_map.keys())
        logger.info(f"Total matched simplified keys present in both EN & FR: {len(common_keys)}")

        # If still empty, dump some diagnostics
        if not common_keys:
            logger.warning("No common simplified keys found. Dumping diagnostics to log.")
            logger.debug("Sample EN keys: %s", list(en_map.keys())[:50])
            logger.debug("Sample FR keys: %s", list(fr_map.keys())[:50])

        output_list = []
        idx = 1
        used_filenames = set()
        total = len(common_keys)
        logger.info(f"Starting download loop for {total} items...")

        for i, key in enumerate(common_keys, start=1):
            logger.info(f"[{i}/{total}] Processing simplified key '{key}'")
            en_candidates = en_map.get(key, [])
            fr_candidates = fr_map.get(key, [])

            # Prefer exact img_file match if possible, else first candidate
            en_entry = None
            fr_entry = None
            if en_candidates:
                en_entry = en_candidates[0]
                # try to find candidate with 'blocksprite' or exact match
                for c in en_candidates:
                    if c.get("img_file") and c.get("img_file").lower().startswith("blocksprite"):
                        en_entry = c
                        break
            if fr_candidates:
                fr_entry = fr_candidates[0]
                for c in fr_candidates:
                    if c.get("img_file") and c.get("img_file").lower().startswith("blocksprite"):
                        fr_entry = c
                        break

            name_en = en_entry["name"] if en_entry else ""
            name_fr = fr_entry["name"] if fr_entry else ""

            # Prefer file_page (FR then EN)
            file_page = (fr_entry.get("file_page") if fr_entry else None) or (en_entry.get("file_page") if en_entry else None)
            full_img_src = None
            if file_page:
                logger.debug(f"  Navigating to file page: {file_page}")
                full_img_src = get_full_image_src_from_filepage(page, file_page, timeout=TIMEOUT)
                if full_img_src:
                    logger.debug(f"  Found full image src on file page: {full_img_src}")
                else:
                    logger.debug("  No full image src found on file page, will fallback.")

            # Fallbacks: FR thumb, EN thumb
            if not full_img_src:
                full_img_src = (fr_entry.get("thumb_src") if fr_entry else None) or (en_entry.get("thumb_src") if en_entry else None)
                if full_img_src:
                    logger.debug(f"  Using thumbnail as fallback: {full_img_src}")

            # Reconstruct from /images/thumb/ pattern
            if full_img_src and "/images/thumb/" in full_img_src:
                try:
                    parsed = urlparse(full_img_src)
                    parts = parsed.path.split("/images/thumb/")
                    if len(parts) == 2:
                        tail = parts[1]
                        original = tail.split("/", 1)[0]
                        candidate = urljoin(f"{parsed.scheme}://{parsed.netloc}", f"/images/{original}")
                        logger.debug(f"  Reconstructed candidate full image URL: {candidate}")
                        full_img_src = candidate
                except Exception:
                    pass

            # Direct images/<basename> fallback
            if not full_img_src and (fr_entry and fr_entry.get("img_file") or en_entry and en_entry.get("img_file")):
                basename = (fr_entry.get("img_file") if fr_entry and fr_entry.get("img_file") else en_entry.get("img_file"))
                candidate = urljoin(EN_URL, f"/images/{basename}")
                logger.debug(f"  Trying direct images path fallback: {candidate}")
                full_img_src = candidate

            if not full_img_src:
                logger.warning(f"  [SKIP] No image source found for key '{key}' (EN='{name_en}' FR='{name_fr}').")
                continue

            img_src = urljoin(EN_URL, full_img_src)

            # Build filename
            filename_base = sanitize_filename(name_en) if name_en else key
            if not filename_base:
                filename_base = f"item_{idx}"

            dest_filename = f"{filename_base}.png"
            suffix = 1
            while dest_filename.lower() in used_filenames or os.path.exists(os.path.join(ASSETS_DIR, dest_filename)):
                dest_filename = f"{filename_base}_{suffix}.png"
                suffix += 1
            used_filenames.add(dest_filename.lower())

            dest_path = os.path.join(ASSETS_DIR, dest_filename)

            if not os.path.exists(dest_path):
                logger.info(f"  Downloading [{idx}] EN='{name_en}' FR='{name_fr}' -> {dest_filename}")
                referer = EN_URL
                ok = download_image_via_page(page, img_src, dest_path, referer=referer)
                if not ok and en_entry and en_entry.get("thumb_src") and en_entry["thumb_src"] != img_src:
                    logger.info("    Retry with EN thumbnail source...")
                    ok = download_image_via_page(page, en_entry["thumb_src"], dest_path, referer=EN_URL)
                if not ok and file_page:
                    logger.info("    Retry: navigate to file page and re-extract full image src...")
                    new_src = get_full_image_src_from_filepage(page, file_page, timeout=TIMEOUT)
                    if new_src:
                        logger.info(f"    Found alternative src: {new_src}, retrying download...")
                        ok = download_image_via_page(page, urljoin(EN_URL, new_src), dest_path, referer=file_page)
                if ok:
                    logger.info(f"  [OK] Saved {dest_filename}")
                else:
                    logger.warning(f"  [FAIL] Could not download image for '{name_en}' / '{name_fr}' (key {key})")
                time.sleep(DELAY_BETWEEN_DOWNLOADS)
            else:
                logger.info(f"  Image exists: {dest_filename}")

            entry = {
                "Index": idx,
                "Name_FR": name_fr,
                "Name_EN": name_en,
                "PictureMain": os.path.join(".", ASSETS_DIR, dest_filename).replace("\\", "/")
            }
            output_list.append(entry)
            idx += 1

        try:
            page.close()
            context.close()
            browser.close()
        except Exception:
            pass

    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(output_list, jf, ensure_ascii=False, indent=2)

    logger.info(f"Done. {len(output_list)} items written to {OUTPUT_JSON}")
    logger.info(f"Images saved to {ASSETS_DIR}")
    logger.info("=== Finished ===")

if __name__ == "__main__":
    main()
