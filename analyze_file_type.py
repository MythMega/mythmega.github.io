import os
import sys
from collections import defaultdict

# --- Paramètres à personnaliser ---
ignored_extensions = [".png", ".mp3", ".jpeg", ".gif", ".avif", ".webp", ".bak", ".log", ".bak"]   # Extensions à ignorer
ignored_dirs = ["node_modules", "__pycache__", ".git", "pokedexLive"]  # Dossiers à ignorer
# ----------------------------------

def main():
    # Gestion des arguments
    mode = "compte"  # par défaut
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if arg in ["-compte", "compte"]:
            mode = "compte"
        elif arg in ["-poids", "poids"]:
            mode = "poids"
        else:
            print("Argument inconnu :", arg)
            print("Arguments possibles : -compte (par défaut), -poids")
            sys.exit(1)

    root_dir = os.getcwd()
    stats = defaultdict(lambda: {"count": 0, "size": 0})

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Exclure les dossiers ignorés
        dirnames[:] = [d for d in dirnames if d not in ignored_dirs]

        for filename in filenames:
            _, ext = os.path.splitext(filename)
            if ext and ext.lower() not in ignored_extensions:
                filepath = os.path.join(dirpath, filename)
                try:
                    size = os.path.getsize(filepath)
                except OSError:
                    size = 0
                stats[ext.lower()]["count"] += 1
                stats[ext.lower()]["size"] += size

    # Calcul du total selon le mode
    if mode == "compte":
        total = sum(v["count"] for v in stats.values())
    else:  # mode == "poids"
        total = sum(v["size"] for v in stats.values())

    # Préparer les résultats
    results = []
    for ext, data in stats.items():
        if total > 0:
            if mode == "compte":
                pct = (data["count"] / total) * 100
            else:
                pct = (data["size"] / total) * 100
        else:
            pct = 0.0
        results.append((ext, data["count"], data["size"], pct))

    # Trier en ordre décroissant par pourcentage
    results.sort(key=lambda x: x[3], reverse=True)

    # Affichage
    print(f"Mode de calcul : {mode.upper()}")
    print("Extensions les plus communes (ordre décroissant) :")
    for ext, count, size, pct in results:
        print(f"{ext} : {pct:.3f}% ({count} fichiers, {size} octets)")

if __name__ == "__main__":
    main()
