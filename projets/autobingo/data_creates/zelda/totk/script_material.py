#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import re
import time
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

INPUT_JSON = "totk_materials.json"
OUTPUT_JSON = "totk_materials_updated.json"
OUTPUT_DIR = "./assets/category/zelda/totk/Material/"
LOG_FILE = "result_materials.log"

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
        if target in alt:
            return img.get("src") or img.get("data-src")

    return None

def extract_any_image(html, item_name):
    soup = BeautifulSoup(html, "html.parser")
    target = item_name.lower()

    for img in soup.find_all("img"):
        alt = img.get("alt", "").lower()
        if target in alt:
            return img.get("src") or img.get("data-src")

    return None

def click_js(page, text):
    page.evaluate(f"""
        [...document.querySelectorAll('span')].find(
            el => el.textContent.trim() === "{text}"
        )?.click();
    """)

def accept_cookies(page):
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
    total = len(items)
    log = open(LOG_FILE, "w", encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()

        for idx, item in enumerate(items, start=1):
            name_en = item["Name_EN"]
            name_clean = sanitize(name_en)
            url = f"https://zeldawiki.wiki/wiki/{name_en.replace(' ', '_')}"

            print(f"\n[{idx}/{total}] {name_en}")
            log.write(f"\n=== {name_en} ===\n")
            log.write(f"[INFO] URL: {url}\n")

            page = context.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
            except:
                log.write("[PAGE ERROR] Could not load page\n")
                print("❌ Page error")
                continue

            time.sleep(1)
            accept_cookies(page)
            time.sleep(1)

            img_url = None

            # 1) Model → TotK
            click_js(page, "Model")
            time.sleep(1)
            click_js(page, "TotK")
            time.sleep(1.2)
            html = page.content()
            img_url = extract_sprite(html, name_en)
            if img_url:
                log.write("[OK] Found in Model → TotK\n")

            # 2) Sprite → TotK
            if not img_url:
                click_js(page, "Sprite")
                time.sleep(1)
                click_js(page, "TotK")
                time.sleep(1.2)
                html = page.content()
                img_url = extract_sprite(html, name_en)
                if img_url:
                    log.write("[OK] Found in Sprite → TotK\n")

            # 3) Model → AoI
            if not img_url:
                click_js(page, "Model")
                time.sleep(1)
                click_js(page, "AoI")
                time.sleep(1.2)
                html = page.content()
                img_url = extract_sprite(html, name_en)
                if img_url:
                    log.write("[OK] Found in Model → AoI\n")

            # 4) Sprite → AoI
            if not img_url:
                click_js(page, "Sprite")
                time.sleep(1)
                click_js(page, "AoI")
                time.sleep(1.2)
                html = page.content()
                img_url = extract_sprite(html, name_en)
                if img_url:
                    log.write("[OK] Found in Sprite → AoI\n")

            # 5) fallback brute
            if not img_url:
                html = page.content()
                img_url = extract_any_image(html, name_en)
                if img_url:
                    log.write("[OK] Found via brute fallback\n")

            page.close()

            if not img_url:
                log.write("[NOT FOUND] No image found\n")
                print("❌ Not found")
                continue

            dest_path = os.path.join(OUTPUT_DIR, f"{name_clean}.png")
            ok = download_image(img_url, dest_path)

            if not ok:
                log.write(f"[DOWNLOAD FAIL] {img_url}\n")
                print("❌ Download failed")
                continue

            # Update JSON (FIXED)
            item["PictureMain"] = f"./assets/category/zelda/totk/Material/{name_clean}.png"

            log.write(f"[OK] Downloaded {img_url}\n")
            print("✔ Success")

        browser.close()

    log.close()

    # Save updated JSON (FIXED)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("\nDone! Check result_materials.log and the Material folder.")

if __name__ == "__main__":
    main()