import json

INPUT_FILE = "minecraft_full_block.json"
OUTPUT_FILE = "minecraft_full_block_clean.json"

# Liste des blocs interdits (FR ou EN)
BLOCKS_TO_REMOVE = {
    "An Ant",
    "Baked Potato Brick Slab",
    "Baked Potato Brick Stairs",
    "Baked Potato Brick Wall",
    "Baked Potato Bricks",
    "Big Brain",
    "Block of Amber",
    "Block of Corrupted Potato Peels",
    "Block of Potato Peels",
    "Box of Infinite Books",
    "Charred Baked Potato Brick Slab",
    "Charred Baked Potato Brick Stairs",
    "Charred Baked Potato Brick Wall",
    "Charred Baked Potato Bricks",
    "Cheese",
    "Compressed Poisonous Potato Block",
    "Copper Sink",
    "Copper Spleaves",
    "Corrupted Peelgrass Block",
    "Cursor",
    "Double Compressed Poisonous Potato Block",
    "Etho Slab",
    "Expired Baked Potato Brick Slab",
    "Expired Baked Potato Brick Stairs",
    "Expired Baked Potato Brick Wall",
    "Expired Baked Potato Bricks",
    "Floatater",
    "Floatato",
    "Frying Table",
    "Funky Portal",
    "Golden Chest",
    "Gravtater",
    "How did we get here? (block)",
    "Leftover",
    "Locked chest",
    "Other Portal (block)",
    "Packed Air",
    "Pedestal",
    "Peelgrass Block",
    "Pickaxe Block",
    "Place Block",
    "Poison Farmland",
    "Poison Path",
    "Poisonous Mashed Potato",
    "Poisonous Potato Block",
    "Poisonous Potato Cutter",
    "Poisonous Potato Head Block",
    "Poisonous Potato Headpiece",
    "Poisonous Potato Ore",
    "Potato Battery",
    "Potato Bud",
    "Potato Button",
    "Potato Door",
    "Potato Fence",
    "Potato Fence Gate",
    "Potato flower",
    "Potato Fruit",
    "Potato Hanging Sign",
    "Potato Leaves",
    "Potato Pedicule",
    "Potato Planks",
    "Potato Portal",
    "Potato Pressure Plate",
    "Potato Refinery",
    "Potato Sign",
    "Potato Slab",
    "Potato Sprouts",
    "Potato Stairs",
    "Potato Stem",
    "Potato Trapdoor",
    "Potone",
    "Potone Copper Ore",
    "Potone Diamond Ore",
    "Potone Gold Ore",
    "Potone Iron Ore",
    "Potone Lapis Lazuli Ore",
    "Potone Redstone Ore",
    "Potone Slab",
    "Potone Stairs",
    "Potone Wall",
    "Powerful Potato",
    "Quadruple Compressed Poisonous Potato Block",
    "Resin Ore",
    "Strong Roots",
    "Swaggiest stairs ever",
    "Taterstone",
    "Taterstone Slab",
    "Taterstone Stairs",
    "Taterstone Wall",
    "Terre de Pomme",
    "Torch (Burnt-out)",
    "Triple Compressed Poisonous Potato Block",
    "USB Charger Block",
    "Vicious Potato",
    "Weak Roots"
}

def clean_json():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    seen = set()
    cleaned_data = []
    removed_count = 0
    duplicate_count = 0

    for item in data:
        name_en = item.get("Name_EN", "").strip()
        name_fr = item.get("Name_FR", "").strip()

        # 1. Suppression des blocs interdits (FR ou EN)
        if name_en in BLOCKS_TO_REMOVE or name_fr in BLOCKS_TO_REMOVE:
            removed_count += 1
            continue

        # 2. Suppression des doublons (basé sur Name_EN)
        if name_en in seen:
            duplicate_count += 1
            continue

        seen.add(name_en)
        cleaned_data.append(item)

    # Aucun changement ?
    if removed_count == 0 and duplicate_count == 0:
        print("✔ Le fichier est déjà clean, aucun doublon ni bloc interdit trouvé.")
        return

    # Sinon, écrire le fichier nettoyé
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, indent=2, ensure_ascii=False)

    print(f"✔ Nettoyage terminé.")
    print(f"  → Doublons supprimés : {duplicate_count}")
    print(f"  → Blocs interdits supprimés : {removed_count}")
    print(f"  → Nouveau fichier créé : {OUTPUT_FILE}")

if __name__ == "__main__":
    clean_json()
