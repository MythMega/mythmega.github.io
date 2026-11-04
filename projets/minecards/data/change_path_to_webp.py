import json
from pathlib import Path

def update_json_paths():
    root_dir = Path(".")
    # Recherche récursive de tous les fichiers JSON
    json_files = list(root_dir.rglob("*.json"))
    
    if not json_files:
        print("⚠️ Aucun fichier JSON trouvé dans le répertoire.")
        return

    print(f"🔍 {len(json_files)} fichier(s) JSON trouvé(s). Modification en cours...\n")

    for file_path in json_files:
        try:
            # Lecture du fichier JSON
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            modified = False

            # Fonction récursive pour chercher et modifier uniquement la clé "Path"
            def process_node(node):
                nonlocal modified
                if isinstance(node, dict):
                    for key, value in node.items():
                        if key == "Path" and isinstance(value, str) and value.endswith(".png"):
                            node[key] = value[:-4] + ".webp"
                            modified = True
                        else:
                            process_node(value)
                elif isinstance(node, list):
                    for item in node:
                        process_node(item)

            process_node(data)

            if modified:
                # Écriture directe dans le fichier d'origine (sans backup)
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"✔ Mis à jour avec succès : {file_path}")
            else:
                print(f"ℹ️ Aucun champ 'Path' .png trouvé dans : {file_path}")

        except Exception as e:
            print(f"❌ Erreur lors du traitement de {file_path} : {e}")

    print("\n✨ Traitement terminé !")

if __name__ == "__main__":
    update_json_paths()