#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wikiscrap_playwright_final.py
Scrape English and French item lists from minecraft.wiki using Playwright,
target only <li> inside <ul> inside <div class="div-col columns column-width">,
keep only sprites whose filename starts with ItemSprite_ or BlockSprite_,
only keep items that have both EN and FR entries (match by sprite filename),
download sprites via browser fetch to avoid 403, and produce minecraft_full.json.

Requirements:
    pip install playwright beautifulsoup4
    python -m playwright install

Usage:
    python wikiscrap_playwright_final.py
"""

import os
import re
import json
import time
import base64
from urllib.parse import urljoin, urlparse, unquote

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

# --- Configuration ---
EN_URL = "https://minecraft.wiki/w/Item"
FR_URL = "https://fr.minecraft.wiki/w/Objet"
OUTPUT_JSON = "minecraft_full.json"
ASSETS_DIR = os.path.join("assets", "category", "minecraft")
DELAY_BETWEEN_DOWNLOADS = 0.12
HEADLESS = True
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

os.makedirs(ASSETS_DIR, exist_ok=True)

# --- Utilitaires ---
def sanitize_filename(name):
    name = name.strip().replace(" ", "_")
    name = re.sub(r'[<>:"/\\|?*\']', "", name)
    name = re.sub(r'__+', "_", name)
    return name[:200] or "item"

def extract_items_from_html_filtered(html, base_url):
    """
    Parse HTML and return list of dicts:
    { 'name': <title from link>, 'img_src': <image src absolute>, 'img_file': <basename without query> }
    Only consider <li> that are inside <ul> inside <div class="div-col columns column-width">.
    """
    soup = BeautifulSoup(html, "html.parser")
    items = []

    # Find the divs that contain the lists we want
    divs = soup.find_all("div", class_="div-col columns column-width")
    for div in divs:
        # For each div, find all ul (descendents) and their li children
        for ul in div.find_all("ul"):
            for li in ul.find_all("li"):
                span_text = li.find("span", class_="sprite-text")
                img_tag = li.find("img")
                a_tag = li.find("a", title=True)
                if span_text and img_tag and a_tag:
                    name = a_tag.get("title") or span_text.get_text(strip=True)
                    src = img_tag.get("src") or img_tag.get("data-src") or ""
                    if not src:
                        continue
                    src_abs = urljoin(base_url, src)
                    parsed = urlparse(src_abs)
                    filename = os.path.basename(parsed.path)
                    filename = unquote(filename)
                    if not filename:
                        continue
                    items.append({
                        "name": name.strip(),
                        "img_src": src_abs,
                        "img_file": filename
                    })
    return items

# --- Téléchargement via page Playwright (fetch dans le navigateur) ---
def download_image_via_page(page, img_url, dest_path, referer=None, timeout=30000):
    """
    Use page.evaluate to fetch the image in the browser and return base64.
    page : Playwright Page
    img_url : image URL
    dest_path : local output path
    referer : optional URL to navigate before fetch to ensure correct context
    """
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
            print(f"  [WARN] Browser fetch failed for {img_url} status={status} error={err}")
    except Exception as e:
        print(f"  [WARN] download_image_via_page exception: {e}")

    # Fallback minimal (unlikely to succeed if server blocks direct requests)
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
        print(f"  [!] Fallback download failed for {img_url}: {e}")
        return False

# --- Main ---
def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()

        print("Loading English page...")
        page.goto(EN_URL, wait_until="networkidle", timeout=60000)
        en_html = page.content()

        print("Loading French page...")
        page.goto(FR_URL, wait_until="networkidle", timeout=60000)
        fr_html = page.content()

        # Parse using filtered extractor
        print("Parsing English items (filtered)...")
        en_items = extract_items_from_html_filtered(en_html, EN_URL)
        print(f"  Found {len(en_items)} EN candidates inside div-col lists.")

        print("Parsing French items (filtered)...")
        fr_items = extract_items_from_html_filtered(fr_html, FR_URL)
        print(f"  Found {len(fr_items)} FR candidates inside div-col lists.")

        # Build maps by sprite filename (lowercase)
        en_map = {it["img_file"].lower(): it for it in en_items}
        fr_map = {it["img_file"].lower(): it for it in fr_items}

        # Keep only sprite filenames that start with ItemSprite_ or BlockSprite_
        def sprite_allowed(key):
            return key.startswith("itemsprite_") or key.startswith("blocksprite_")

        # Only keep keys present in BOTH EN and FR (intersection) and matching allowed prefixes
        common_keys = sorted(k for k in en_map.keys() & fr_map.keys() if sprite_allowed(k))
        print(f"Total matched sprite filenames (ItemSprite_/BlockSprite_ and present in both EN & FR): {len(common_keys)}")

        output_list = []
        idx = 1
        used_filenames = set()

        # Reuse the same page for all fetches
        for key in common_keys:
            en_entry = en_map.get(key)
            fr_entry = fr_map.get(key)

            name_en = en_entry["name"] if en_entry else ""
            name_fr = fr_entry["name"] if fr_entry else ""
            img_src = fr_entry["img_src"] if fr_entry and fr_entry.get("img_src") else (en_entry["img_src"] if en_entry else None)
            if not img_src:
                continue

            # Build a safe filename from English name, fallback to sprite base
            filename_base = sanitize_filename(name_en) if name_en else os.path.splitext(key)[0]
            if not filename_base:
                filename_base = f"item_{idx}"

            # Avoid collisions: add suffix if filename already used
            dest_filename = f"{filename_base}.png"
            suffix = 1
            while dest_filename.lower() in used_filenames or os.path.exists(os.path.join(ASSETS_DIR, dest_filename)):
                dest_filename = f"{filename_base}_{suffix}.png"
                suffix += 1
            used_filenames.add(dest_filename.lower())

            dest_path = os.path.join(ASSETS_DIR, dest_filename)

            if not os.path.exists(dest_path):
                print(f"Downloading [{idx}] EN='{name_en}' FR='{name_fr}' -> {dest_filename}")
                referer = EN_URL  # use EN page as referer for fetch context
                ok = download_image_via_page(page, img_src, dest_path, referer=referer)
                if not ok and en_entry and en_entry.get("img_src") and en_entry["img_src"] != img_src:
                    print("  Retry with EN image source...")
                    ok = download_image_via_page(page, en_entry["img_src"], dest_path, referer=EN_URL)
                time.sleep(DELAY_BETWEEN_DOWNLOADS)
            else:
                print(f"Image exists: {dest_filename}")

            entry = {
                "Index": idx,
                "Name_FR": name_fr,
                "Name_EN": name_en,
                "PictureMain": os.path.join(".", ASSETS_DIR, dest_filename).replace("\\", "/")
            }
            output_list.append(entry)
            idx += 1

        # Close browser
        try:
            page.close()
            context.close()
            browser.close()
        except Exception:
            pass

    # Save JSON
    with open(OUTPUT_JSON, "w", encoding="utf-8") as jf:
        json.dump(output_list, jf, ensure_ascii=False, indent=2)

    print(f"\nDone. {len(output_list)} items written to {OUTPUT_JSON}")
    print(f"Images saved to {ASSETS_DIR}")

if __name__ == "__main__":
    main()
