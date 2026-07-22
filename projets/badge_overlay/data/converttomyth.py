import csv
import os
import requests
import shutil
import unicodedata

# --- Helpers ---
def sanitize(name: str) -> str:
    """Sanitize folder names: lowercase, no spaces, no special chars."""
    name = name.lower().strip()
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if c.isalnum() or c in ['-', '_'])
    name = name.replace(" ", "_")
    return name

# --- Step 0: Rename data.csv → old_data.csv ---
if os.path.exists("data.csv"):
    # If old_data.csv already exists, delete it
    if os.path.exists("old_data.csv"):
        os.remove("old_data.csv")

    os.rename("data.csv", "old_data.csv")
    print("Renamed data.csv → old_data.csv")
else:
    print("⚠ Aucun fichier data.csv trouvé. Le script s'arrête.")
    exit()

# --- Step 1: Read CSV ---
rows = []
with open("old_data.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)

# --- Step 2: Process each row ---
output_rows = []
base_url = "https://raw.githubusercontent.com/MythMega/mythmega.github.io.assets/refs/heads/master/assets/category/pokemon/badges/"

for row in rows:
    game = row["Game"]
    badge = row["Badge Name"]
    img_url = row["url"]

    folder = sanitize(game)
    filename = sanitize(badge) + ".png"

    # Create folder if needed
    os.makedirs(folder, exist_ok=True)

    # Download image
    img_data = requests.get(img_url, stream=True)
    if img_data.status_code == 200:
        with open(os.path.join(folder, filename), "wb") as img_file:
            shutil.copyfileobj(img_data.raw, img_file)
    else:
        print(f"⚠ Impossible de télécharger {img_url}")

    # Build new URL
    new_url = base_url + folder + "/" + filename

    # Add to output CSV
    output_rows.append({
        "Game": game,
        "Badge Name": badge,
        "Location": row["Location"],
        "Champion": row["Champion"],
        "url": new_url
    })

# --- Step 3: Write new CSV ---
with open("data.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["Game", "Badge Name", "Location", "Champion", "url"])
    writer.writeheader()
    writer.writerows(output_rows)

print("✔ Done! Images downloaded and data.csv created.")
