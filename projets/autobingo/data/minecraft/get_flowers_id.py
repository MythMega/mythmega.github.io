import json

REFERENCE_FILE = "mc26.3.q-full.json"

FLOWER_NAMES = {
    "Allium",
    "Azure Bluet",
    "Blue Orchid",
    "Cornflower",
    "Dandelion",
    "Closed Eyeblossom",
    "Open Eyeblossom",
    "Golden Dandelion",
    "Lily of the Valley",
    "Oxeye Daisy",
    "Poppy",
    "Torchflower",
    "Orange Tulip",
    "Pink Tulip",
    "Red Tulip",
    "White Tulip",
    "Wither Rose",
    "Lilac",
    "Peony",
    "Pitcher Plant",
    "Rose Bush",
    "Sunflower",
    "Pink Petals",
    "Spore Blossom",
    "Wildflowers",
    "Cactus Flower"
}

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def main():
    data = load_json(REFERENCE_FILE)
    ids = []

    for item in data.get("Items", []):
        name_en = item.get("Name_EN", "")
        name_fr = item.get("Name_FR", "")

        if name_en in FLOWER_NAMES or name_fr in FLOWER_NAMES:
            ids.append(item.get("Index"))

    print("\n=== IDs trouvés dans le témoin ===\n")
    for idx in ids:
        print(idx)

    print(f"\nTotal : {len(ids)} items trouvés")

    # Liste prête à copier-coller
    print("\n=== Liste Python prête à copier-coller ===\n")
    print("[")
    for idx in ids:
        print(f'  "{idx}",')
    print("]")

if __name__ == "__main__":
    main()
