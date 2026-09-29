import json
import os


def truncate_sentences(text: str, max_sentences: int) -> str:
    """Découpe le texte selon les points et conserve uniquement les 'max_sentences' premières phrases."""
    if not text or not isinstance(text, str):
        return text

    # Découpage au niveau des points
    parts = text.split(".")

    # Si le texte se terminait par un point, le dernier élément est une chaîne vide
    if parts and parts[-1].strip() == "":
        parts.pop()

    # Si la description contient déjà moins ou autant de phrases que la limite, on ne touche à rien
    if len(parts) <= max_sentences:
        return text

    # Conserve les N premières phrases et rajoute le point final
    return ".".join(parts[:max_sentences]).strip() + "."


def main():
    # 1. Demande du nombre de phrases à conserver
    try:
        max_sentences = int(
            input("Nombre de phrases maximum à conserver par description : ")
        )
        if max_sentences <= 0:
            print("Erreur : Le nombre de phrases doit être supérieur à 0.")
            return
    except ValueError:
        print("Erreur : Veuillez entrer un nombre entier valide.")
        return

    # 2. Lister les fichiers .json du répertoire courant
    json_files = [
        f for f in os.listdir(".") if f.endswith(".json") and os.path.isfile(f)
    ]
    if not json_files:
        print("Aucun fichier .json trouvé dans le dossier actuel.")
        return

    print("\nFichiers JSON disponibles :")
    for idx, filename in enumerate(json_files, 1):
        print(f"  [{idx}] {filename}")

    # 3. Sélection du fichier
    choice = input(
        "\nEntrez le numéro ou le nom du fichier à modifier : "
    ).strip()
    selected_file = None

    if choice.isdigit():
        index = int(choice) - 1
        if 0 <= index < len(json_files):
            selected_file = json_files[index]
    else:
        if choice in json_files:
            selected_file = choice
        elif choice + ".json" in json_files:
            selected_file = choice + ".json"

    if not selected_file or not os.path.isfile(selected_file):
        print("Choix invalide ou fichier introuvable.")
        return

    # 4. Lecture du fichier
    with open(selected_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    cards = data.get("Cards", []) if isinstance(data, dict) else data

    # 5. Repérage des Index/ID ayant au moins une version "fullart"
    fullart_indexes = set()
    for card in cards:
        layout = str(card.get("Layout", "")).lower()
        if "fullart" in layout:
            card_id = card.get("Index") or card.get("id")
            if card_id:
                fullart_indexes.add(card_id)

    print(
        f"\n{len(fullart_indexes)} ID(s) de carte avec au moins un layout 'fullart' identifié(s)."
    )

    # 6. Application de la limitation sur toutes les clés de description (Desc_FR, Desc_EN, etc.)
    modified_count = 0
    for card in cards:
        card_id = card.get("Index") or card.get("id")
        if card_id in fullart_indexes:
            # Récupère dynamiquement toutes les clés contenant "desc" (ex: Desc_FR, Desc_EN, Description)
            desc_keys = [k for k in card.keys() if "desc" in k.lower()]
            for key in desc_keys:
                original_text = card[key]
                if original_text and isinstance(original_text, str):
                    new_text = truncate_sentences(original_text, max_sentences)
                    if original_text != new_text:
                        card[key] = new_text
                        modified_count += 1

    # 7. Écriture du fichier mis à jour
    with open(selected_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(
        f"Terminé : {modified_count} champ(s) de description mis à jour dans '{selected_file}'."
    )


if __name__ == "__main__":
    main()