import os
import json
import re
from playwright.sync_api import sync_playwright

def get_wiki_description(page, url, lang_label, name_en):
    """
    Récupère la première ligne de description valide sur une page Minecraft Wiki.
    """
    print(f"[{lang_label}] Tentative de récupération pour '{name_en}' -> {url}")
    try:
        # Navigation vers la page avec timeout de 30s
        response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        
        if response and response.status >= 400:
            print(f"  ❌ Erreur HTTP {response.status} pour {url}")
            return None

        # Attente de la présence du conteneur de contenu MediaWiki
        page.wait_for_selector(".mw-parser-output", timeout=10000)
        
        # Récupération de tous les paragraphes directes
        paragraphs = page.locator(".mw-parser-output > p").all()
        
        for p in paragraphs:
            text = p.inner_text().strip()
            
            # Nettoyage : suppression des crochets de référence style [1], [2] et des espaces multiples
            text = re.sub(r'\[\d+\]', '', text)
            text = " ".join(text.split())
            
            # On prend le premier paragraphe non vide
            if text:
                preview = text[:80] + ("..." if len(text) > 80 else "")
                print(f"  ✅ Succès [{lang_label}] : {preview}")
                return text
                
        print(f"  ⚠️ Aucun paragraphe valide trouvé pour {url}")
        return None

    except Exception as e:
        print(f"  ❌ Exception lors du scraping de {url} : {e}")
        return None


def process_json_files():
    # Dossier où se trouve le script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Récupération des fichiers .json dans le même dossier (non-récursif)
    json_files = [f for f in os.listdir(script_dir) if f.endswith(".json")]

    if not json_files:
        print("Aucun fichier JSON trouvé dans le dossier du script.")
        return

    print(f"Fichier(s) JSON trouvé(s) ({len(json_files)}) : {json_files}\n")

    # Dictionnaires de cache pour éviter de scrapper plusieurs fois le même item
    cache_en = {}
    cache_fr = {}

    with sync_playwright() as p:
        # Lancement du navigateur Chromium
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        for json_filename in json_files:
            file_path = os.path.join(script_dir, json_filename)
            print("=" * 60)
            print(f"Traitement du fichier : {json_filename}")
            print("=" * 60)

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                print(f"❌ Erreur lors de la lecture du fichier {json_filename} : {e}")
                continue

            cards = data.get("Cards", [])
            if not isinstance(cards, list):
                print(f"⚠️ Le champ 'Cards' n'est pas une liste dans {json_filename}. Ignoré.")
                continue

            modified = False

            for card in cards:
                name_en = card.get("Name_EN")
                if not name_en:
                    continue

                # Formater le nom anglais pour l'URL (ex: "Wooden Sword" -> "Wooden_Sword")
                formatted_name = name_en.strip().replace(" ", "_")

                url_en = f"https://minecraft.wiki/w/{formatted_name}"
                url_fr = f"https://fr.minecraft.wiki/w/{formatted_name}"

                # --- 1. Récupération Description Anglaise ---
                if name_en in cache_en:
                    print(f"[EN] Cache utilisé pour '{name_en}'")
                    desc_en = cache_en[name_en]
                else:
                    desc_en = get_wiki_description(page, url_en, "EN", name_en)
                    if desc_en:
                        cache_en[name_en] = desc_en

                if desc_en:
                    card["Desc_EN"] = desc_en
                    modified = True

                # --- 2. Récupération Description Française ---
                if name_en in cache_fr:
                    print(f"[FR] Cache utilisé pour '{name_en}'")
                    desc_fr = cache_fr[name_en]
                else:
                    desc_fr = get_wiki_description(page, url_fr, "FR", name_en)
                    if desc_fr:
                        cache_fr[name_en] = desc_fr

                if desc_fr:
                    card["Desc_FR"] = desc_fr
                    modified = True

            # Sauvegarde des modifications si au moins une carte a été mise à jour
            if modified:
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"\n💾 Fichier '{json_filename}' mis à jour et sauvegardé.\n")

        browser.close()


if __name__ == "__main__":
    process_json_files()