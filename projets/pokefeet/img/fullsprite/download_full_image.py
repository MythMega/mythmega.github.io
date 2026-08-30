#!/usr/bin/env python3
import requests
import time

START = 494
END = 649
BASE_URL = "https://s3.pokeos.com/pokeos-uploads/assets/pokemon/home/render/{num}.png"
HEADERS = {"User-Agent": "python-requests/2.x (+https://example.com)"}
RETRIES = 3
DELAY_BETWEEN = 0.2  # secondes entre les requêtes

def download_image(num):
    url = BASE_URL.format(num=num)
    filename = f"{num}.png"
    for attempt in range(1, RETRIES + 1):
        try:
            resp = requests.get(url, stream=True, headers=HEADERS, timeout=10)
            if resp.status_code == 200:
                with open(filename, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                print(f"[OK]  {num} -> {filename}")
                return True
            else:
                print(f"[ERR] {num} HTTP {resp.status_code} (attempt {attempt}/{RETRIES})")
        except requests.RequestException as e:
            print(f"[ERR] {num} {e} (attempt {attempt}/{RETRIES})")
        time.sleep(1)  # attente avant nouvelle tentative
    print(f"[FAIL] {num} après {RETRIES} tentatives")
    return False

def main():
    for n in range(START, END + 1):
        download_image(n)
        time.sleep(DELAY_BETWEEN)

if __name__ == "__main__":
    main()
