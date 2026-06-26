import os
import json

DATA_DIR = "./"   # Dossier contenant les JSON

# Liste des noms anglais à supprimer
NAMES_TO_REMOVE = {
    "Blue Torch",
    "Board",
    "Compound Creator",
    "Element Constructor",
    "Green Torch",
    "Hardened Black Stained Glass",
    "Hardened Black Stained Glass Pane",
    "Hardened Blue Stained Glass",
    "Hardened Blue Stained Glass Pane",
    "Hardened Brown Stained Glass",
    "Hardened Brown Stained Glass Pane",
    "Hardened Cyan Stained Glass",
    "Hardened Cyan Stained Glass Pane",
    "Hardened Glass",
    "Hardened Glass Pane",
    "Hardened Gray Stained Glass",
    "Hardened Gray Stained Glass Pane",
    "Hardened Green Stained Glass",
    "Hardened Green Stained Glass Pane",
    "Hardened Light Blue Stained Glass",
    "Hardened Light Blue Stained Glass Pane",
    "Hardened Light Gray Stained Glass",
    "Hardened Light Gray Stained Glass Pane",
    "Hardened Lime Stained Glass",
    "Hardened Lime Stained Glass Pane",
    "Hardened Magenta Stained Glass",
    "Hardened Magenta Stained Glass Pane",
    "Hardened Orange Stained Glass",
    "Hardened Orange Stained Glass Pane",
    "Hardened Pink Stained Glass",
    "Hardened Pink Stained Glass Pane",
    "Hardened Purple Stained Glass",
    "Hardened Purple Stained Glass Pane",
    "Hardened Red Stained Glass",
    "Hardened Red Stained Glass Pane",
    "Hardened White Stained Glass",
    "Hardened White Stained Glass Pane",
    "Hardened Yellow Stained Glass",
    "Hardened Yellow Stained Glass Pane",
    "Heat Block",
    "Lab Table",
    "Material Reducer",
    "Poster",
    "Purple Torch",
    "Red Torch",
    "Slate",
    "Underwater TNT",
    "Underwater Torch",
    "Gear",
    "grass_carried",
    "Lava Spawner",
    "Water Spawner",
    "leaves_carried",
    "Locked chest",
    "mysterious_frame_slot",
    "Shrub",
    "Structure Air",
    "End Portal (block)",
    "End Gateway (block)",
    "End Portal Frame",
    "Allow",
    "Border",
    "Deny",
    "Dimension Control",
    "Fire",
    "Soul Fire"
    "Player Head",
    "Reinforced Deepslate"
}

def process_json_file(path):
    """Nettoie un fichier JSON en supprimant les items interdits."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "Items" not in data or not isinstance(data["Items"], list):
        return False  # rien à faire

    original_count = len(data["Items"])

    # Filtrage
    data["Items"] = [
        item for item in data["Items"]
        if item.get("Name_EN") not in NAMES_TO_REMOVE
    ]

    removed = original_count - len(data["Items"])

    # Renommage du fichier original
    backup_path = path + ".old"
    os.rename(path, backup_path)

    # Écriture du fichier nettoyé sous le nom original
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"✔ {os.path.basename(path)} : {removed} item(s) supprimé(s)")
    return True


def main():
    print("=== Nettoyage des JSON Minecraft ===")

    for file in os.listdir(DATA_DIR):
        if file.endswith(".json") and not file.endswith(".json.old"):
            full_path = os.path.join(DATA_DIR, file)
            try:
                process_json_file(full_path)
            except Exception as e:
                print(f"⚠ Erreur sur {file} : {e}")

    print("\nTerminé.")


if __name__ == "__main__":
    main()
