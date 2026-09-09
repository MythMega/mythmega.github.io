# sullygnome_fetch.py
import json
import time
import logging
import requests
from pathlib import Path
from typing import Optional

# ----------------- Configuration -----------------
USERS_FILE = "users.json"
GAME_DATA_DIR = Path("./main_users/game_data")
PROFILE_DATA_DIR = Path("./main_users/profile_data")
DEBUG_DIR = Path("./main_users/debug")
LOG_FILE = "script_debug.log"

# HTTP / retry settings
REQUEST_TIMEOUT = 20  # seconds
MAX_RETRIES = 4
BACKOFF_FACTOR = 1.5  # exponential backoff multiplier
SLEEP_BETWEEN_USERS = 1.0  # seconds

# Headers
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/115.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

# Base URLs
SEARCH_URL_TEMPLATE = "https://sullygnome.com/api/standardsearch/{}"
GAMES_URL_TEMPLATE = "https://sullygnome.com/api/tables/channeltables/games/7300/{}/%20/1/2/desc/0/200"

# Ensure directories exist
GAME_DATA_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_DATA_DIR.mkdir(parents=True, exist_ok=True)
DEBUG_DIR.mkdir(parents=True, exist_ok=True)

# ----------------- Logging -----------------
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("sullygrab")

# ----------------- Utilities -----------------
def load_users(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def save_raw(path: Path, content: bytes):
    with open(path, "wb") as f:
        f.write(content)

def request_with_retries(session: requests.Session, method: str, url: str, **kwargs) -> Optional[requests.Response]:
    """
    Effectue une requête HTTP avec retries exponentiels.
    Retourne Response si succès (status_code 200), sinon None.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.debug("Requête [%d/%d] %s %s", attempt, MAX_RETRIES, method.upper(), url)
            resp = session.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
            logger.debug("Statut HTTP: %s pour %s", resp.status_code, url)
            # Accept 200 as success; still return response for other codes to inspect
            return resp
        except requests.RequestException as e:
            wait = BACKOFF_FACTOR ** (attempt - 1)
            logger.warning("Erreur requête (attempt %d) pour %s : %s — attente %.1fs avant retry",
                           attempt, url, e, wait)
            time.sleep(wait)
    logger.error("Échec après %d tentatives pour %s", MAX_RETRIES, url)
    return None

# ----------------- Core logic -----------------
def select_matching_item(items, pseudo_lower: str):
    """
    Sélectionne l'item dont 'siteurl' correspond exactement à pseudo_lower.
    Retourne l'item ou None.
    """
    if not isinstance(items, list):
        return None
    for item in items:
        siteurl = item.get("siteurl", "")
        if isinstance(siteurl, str) and siteurl.lower() == pseudo_lower:
            return item
    return None

def process_pseudo(session: requests.Session, pseudo: str):
    pseudo_lower = pseudo.lower()
    logger.info("=== Traitement pseudo: %s ===", pseudo)

    # 1) standardsearch
    search_url = SEARCH_URL_TEMPLATE.format(pseudo)
    logger.info("Lancement recherche standard: %s", search_url)
    resp = request_with_retries(session, "GET", search_url)
    if resp is None:
        logger.error("Aucune réponse pour la recherche standard de %s", pseudo)
        return

    # Log and save raw response for debugging
    debug_search_raw = DEBUG_DIR / f"{pseudo_lower}_search_raw.json"
    try:
        save_raw(debug_search_raw, resp.content)
        logger.debug("Réponse brute search sauvegardée: %s", debug_search_raw)
    except Exception as e:
        logger.warning("Impossible de sauvegarder la réponse brute search: %s", e)

    if resp.status_code != 200:
        logger.error("Recherche standard pour %s a retourné HTTP %s", pseudo, resp.status_code)
        return

    try:
        items = resp.json()
        logger.debug("Search JSON reçu pour %s : %s items", pseudo, len(items) if isinstance(items, list) else "N/A")
    except Exception as e:
        logger.exception("Impossible de parser JSON de la recherche pour %s: %s", pseudo, e)
        return

    # 2) sélectionner l'item correspondant exactement à siteurl == pseudo_lower
    selected = select_matching_item(items, pseudo_lower)
    if not selected:
        logger.warning("Aucun item correspondant exactement à siteurl='%s' pour %s", pseudo_lower, pseudo)
        # Optionnel : on peut sauvegarder la liste complète pour inspection
        save_json(DEBUG_DIR / f"{pseudo_lower}_search_parsed.json", items)
        return

    # Sauvegarder profile_data (liste contenant uniquement l'item sélectionné)
    profile_path = PROFILE_DATA_DIR / f"{pseudo_lower}.json"
    try:
        save_json(profile_path, [selected])
        logger.info("Profile data sauvegardé: %s", profile_path)
    except Exception as e:
        logger.exception("Erreur en sauvegardant profile_data pour %s: %s", pseudo, e)

    # Récupérer ID_SULLYGNOME depuis 'value'
    id_sully = selected.get("value")
    if id_sully is None:
        logger.error("Item sélectionné pour %s ne contient pas 'value'", pseudo)
        return

    # 3) récupérer game_data via l'URL construite
    games_url = GAMES_URL_TEMPLATE.format(id_sully)
    logger.info("Récupération game_data: %s", games_url)
    resp_games = request_with_retries(session, "GET", games_url)
    if resp_games is None:
        logger.error("Aucune réponse pour game_data de %s (ID %s)", pseudo, id_sully)
        return

    debug_games_raw = DEBUG_DIR / f"{pseudo_lower}_games_raw.json"
    try:
        save_raw(debug_games_raw, resp_games.content)
        logger.debug("Réponse brute games sauvegardée: %s", debug_games_raw)
    except Exception as e:
        logger.warning("Impossible de sauvegarder la réponse brute games: %s", e)

    if resp_games.status_code != 200:
        logger.error("Requête games pour %s a retourné HTTP %s", pseudo, resp_games.status_code)
        return

    try:
        games_data = resp_games.json()
    except Exception as e:
        logger.exception("Impossible de parser JSON games pour %s: %s", pseudo, e)
        return

    # Sauvegarder game_data
    game_path = GAME_DATA_DIR / f"{pseudo_lower}.json"
    try:
        save_json(game_path, games_data)
        logger.info("Game data sauvegardé: %s", game_path)
    except Exception as e:
        logger.exception("Erreur en sauvegardant game_data pour %s: %s", pseudo, e)

# ----------------- Entrypoint -----------------
def main():
    # Session partagée pour réutiliser connexions et cookies si besoin
    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)

    try:
        users = load_users(USERS_FILE)
    except Exception as e:
        logger.exception("Impossible de charger %s: %s", USERS_FILE, e)
        return

    if not isinstance(users, list):
        logger.error("Format de %s invalide : attendu une liste de pseudos", USERS_FILE)
        return

    logger.info("Démarrage traitement pour %d utilisateurs", len(users))
    for pseudo in users:
        try:
            process_pseudo(session, pseudo)
        except Exception as e:
            logger.exception("Exception inattendue lors du traitement de %s: %s", pseudo, e)
        time.sleep(SLEEP_BETWEEN_USERS)

    logger.info("Traitement terminé")

if __name__ == "__main__":
    main()
