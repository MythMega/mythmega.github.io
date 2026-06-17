#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import re
import time
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

INPUT_JSON = "totk_armor.json"
OUTPUT_DIR = "./assets/category/zelda/totk/Armor/"
LOG_FILE = "result.log"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def sanitize(name):
    return re.sub(r'[^a-zA-Z0-9_-]', '_', name)

def download_image(url, dest):
    if url.startswith("//"):
        url = "https:" + url
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        return True
    except Exception:
        return False

def extract_sprite(html, item_name):
    soup = BeautifulSoup(html, "html.parser")
    target = item_name.lower()

    for img in soup.select("div.content--active img"):
        alt = img.get("alt", "").lower()
        if "sprite" in alt and target in alt:
            return img.get("src") or img.get("data-src")

    return None

def click_js(page, text):
    """Clique un onglet via JS pour éviter les frames détachés."""
    page.evaluate(f"""
        [...document.querySelectorAll('span')].find(
            el => el.textContent.trim() === "{text}"
        )?.click();
    """)

def accept_cookies(page):
    """Accepte les cookies via JS."""
    page.evaluate("""
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => 
            b.textContent.includes("Accept") ||
            b.textContent.includes("agree") ||
            b.textContent.includes("OK")
        );
        btn?.click();
    """)

def main():
    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data["Items"]
    log = open(LOG_FILE, "w", encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()

        for item in items:
            name_en = item["Name_EN"]
            name_clean = sanitize(name_en)
            url = f"https://zeldawiki.wiki/wiki/{name_en.replace(' ', '_')}"

            print(f"\n=== Processing {name_en} ===")
            log.write(f"\n=== {name_en} ===\n")
            log.write(f"[INFO] URL: {url}\n")

            page = context.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
            except:
                log.write("[PAGE ERROR] Could not load page\n")
                continue

            time.sleep(1)

            # Accept cookies
            accept_cookies(page)
            time.sleep(1)

            # 1) Click Sprite (JS)
            click_js(page, "Sprite")
            log.write("[ACTION] Clicked Sprite (JS)\n")
            time.sleep(1.2)

            # 2) Click TotK (JS)
            click_js(page, "TotK")
            log.write("[ACTION] Clicked TotK (JS)\n")
            time.sleep(1.2)

            html = page.content()
            img_url = extract_sprite(html, name_en)

            # 3) Fallback BotW
            if not img_url:
                log.write("[INFO] TotK not found, trying BotW\n")
                click_js(page, "BotW")
                time.sleep(1.2)
                html = page.content()
                img_url = extract_sprite(html, name_en)

            page.close()

            if not img_url:
                log.write("[NOT FOUND] No sprite found\n")
                continue

            dest_path = os.path.join(OUTPUT_DIR, f"{name_clean}.png")
            ok = download_image(img_url, dest_path)

            if not ok:
                log.write(f"[DOWNLOAD FAIL] {img_url}\n")
                continue

            log.write(f"[OK] Downloaded {img_url}\n")

        browser.close()

    log.close()
    print("\nDone! Check result.log and the Armor folder.")

if __name__ == "__main__":
    main()
