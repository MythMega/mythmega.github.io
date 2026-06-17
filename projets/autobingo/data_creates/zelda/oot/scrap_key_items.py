#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import csv
import re
import time
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

URL = "https://zelda.fandom.com/wiki/Items_in_Ocarina_of_Time"

ITEMS = [
    "Deku Stick","Deku Nut","Bomb","Fairy Bow","Fire Arrow","Din's Fire",
    "Fairy Slingshot","Ocarina of Time","Bombchu","Longshot","Ice Arrow",
    "Farore's Wind","Boomerang","Lens of Truth","Eye of Truth","Magic Bean",
    "Megaton Hammer","Light Arrow","Arrow of Light","Nayru's Love","Bottle",
    "Red Potion","Green Potion","Blue Potion","Lon Lon Milk","Fairy",
    "Fairy's Spirit","Fish","Bug","Blue Fire","Poe Soul","Big Poe Soul",
    "Letter in a Bottle","Weird Egg","Cucco","Zelda's Letter","Keaton Mask",
    "Skull Mask","Spooky Mask","Bunny Hood","Mask of Truth","Goron Mask",
    "Zora Mask","Gerudo Mask","Pocket Egg","Pocket Cucco","Cojiro",
    "Odd Mushroom","Odd Potion","Poacher's Saw","Broken Goron's Sword",
    "Prescription","Eyeball Frog","World's Finest Eye Drops",
    "Biggoron's Eye Drops","Claim Check","Kokiri Sword","Master Sword",
    "Biggoron's Sword","Deku Shield","Hylian Shield","Mirror Shield",
    "Kokiri Tunic","Goron Tunic","Heat-Resistant Tunic","Zora Tunic",
    "Spiritual Stone of the Forest","Kokiri's Emerald",
    "Spiritual Stone of Fire","Goron's Ruby","Red Stone",
    "Spiritual Stone of Water","Zora's Engagement Ring","Zora's Sapphire",
    "Light Medallion","Forest Medallion","Fire Medallion",
    "Water Medallion","Shadow Medallion","Spirit Medallion",
    "Blue Rupee","Bundle of Arrows","Deku Seed","Green Rupee",
    "Gold Rupee","Huge Rupee","Heart","Recovery Heart",
    "Heart Container","Magic Jar","Purple Rupee","Red Rupee",
    "Silver Rupee","Jewel of White"
]

OUTPUT_DIR = "./oot/"
CSV_FILE = "oot_items.csv"
LOG_FILE = "result.log"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def sanitize(name):
    return re.sub(r'[^a-zA-Z0-9_-]', '_', name)

def get_real_image_url(img):
    """Return the real image URL, handling lazy-loaded images."""
    src = img.get("src", "")
    data_src = img.get("data-src", "")

    # If src is a transparent pixel → use data-src
    if src.startswith("data:image"):
        return data_src or None

    # Otherwise use src
    return src or data_src or None

def download_image(url, dest):
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        return True
    except Exception:
        return False

def main():
    print("Loading page with Playwright...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        page.goto(URL, wait_until="domcontentloaded", timeout=60000)

        # Scroll to force lazy-loading
        for _ in range(10):
            page.mouse.wheel(0, 2000)
            time.sleep(0.5)

        html = page.content()

        # Save debug HTML
        with open("debug_page.html", "w", encoding="utf-8") as f:
            f.write(html)

        browser.close()

    print("Parsing rendered HTML...")
    soup = BeautifulSoup(html, "html.parser")

    gallery_imgs = soup.select("ul.gallery img")
    print(f"Found {len(gallery_imgs)} gallery images")

    # Build map alt → real image URL
    img_map = {}
    for img in gallery_imgs:
        alt = img.get("alt", "").strip().lower()
        real_url = get_real_image_url(img)
        if alt and real_url:
            img_map[alt] = real_url

    log = open(LOG_FILE, "w", encoding="utf-8")
    csvfile = open(CSV_FILE, "w", newline="", encoding="utf-8")
    writer = csv.writer(csvfile)
    writer.writerow(["itemname", "imgsrc"])

    print("Matching items...")

    for item in ITEMS:
        item_clean = sanitize(item)
        item_lower = item.lower()

        match = None
        for alt, src in img_map.items():
            if item_lower in alt:
                match = src
                break

        if not match:
            log.write(f"[NOT FOUND] {item}\n")
            continue

        dest_path = os.path.join(OUTPUT_DIR, f"{item_clean}.png")
        ok = download_image(match, dest_path)

        if not ok:
            log.write(f"[DOWNLOAD FAIL] {item} -> {match}\n")
            continue

        writer.writerow([item, f"./oot/{item_clean}.png"])
        log.write(f"[OK] {item} -> {match}\n")

    log.close()
    csvfile.close()
    print("Done! Check oot/, oot_items.csv and result.log")

if __name__ == "__main__":
    main()
