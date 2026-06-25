import json
import re

REFERENCE_FILE = "mc26.3.q-full.json"

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def main():
    data = load_json(REFERENCE_FILE)

    block_items = []
    item_items = []

    # Séparer les items par type
    for item in data.get("Items", []):
        idx = item.get("Index", "")

        if idx.startswith("block-"):
            block_items.append(item)
        elif idx.startswith("item-"):
            item_items.append(item)
        else:
            print(f"⚠️ Index inconnu ignoré : {idx}")

    # Tri par numéro existant (si possible)
    def extract_num(idx):
        m = re.search(r"(\d+)$", idx)
        return int(m.group(1)) if m else 999999

    block_items.sort(key=lambda x: extract_num(x["Index"]))
    item_items.sort(key=lambda x: extract_num(x["Index"]))

    # Réassignation propre
    for i, item in enumerate(block_items, start=1):
        item["Index"] = f"block-{i:06d}"

    for i, item in enumerate(item_items, start=1):
        item["Index"] = f"item-{i:06d}"

    # Fusion finale
    data["Items"] = block_items + item_items

    save_json(REFERENCE_FILE, data)

    print(f"✔ Réassignation terminée :")
    print(f"  → {len(block_items)} blocks réindexés")
    print(f"  → {len(item_items)} items réindexés")
    print("  → Index propres, uniques et auto-incrémentés")

if __name__ == "__main__":
    main()
