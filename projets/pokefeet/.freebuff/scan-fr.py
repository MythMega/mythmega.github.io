import os, re

FR_WORDS = r"(Échec|Erreur|Déjà|Aucun|Aucune|Impossible|Terminé|Partie|Points|Rafraîchir|Par défaut|Défaut|Bloc|rejouer|Rejouer|Nouveau|débloqu|Copié|Rapport|Veuillez|Chargement|Score|Indice|Trouvé|joué|attention|fenêtre|nécessaire|Aucun)"

pat = re.compile(r"(['\"`])((?:[^'\"`\\\n]|\\.)*?)\1")
files = []
for root, dirs, fs in os.walk('.'):
    if '.git' in root or 'node_modules' in root:
        continue
    for f in fs:
        if f.endswith('.js'):
            files.append(os.path.join(root, f))

print("=== chaines FR en dur (hors fallback Translator/T) ===")
for p in sorted(files):
    lines = open(p, encoding='utf-8', errors='ignore').read().split('\n')
    for i, line in enumerate(lines):
        if 'Translator' in line or re.search(r"\bT\(", line) or 'i18n' in line:
            continue
        if 'console.' in line:
            continue
        for m in pat.finditer(line):
            s = m.group(2)
            if len(s) < 3:
                continue
            if re.search(FR_WORDS, s) and re.search(r"[a-zA-Z]", s):
                out = line.strip()[:120].encode('ascii', 'replace').decode('ascii')
                print("%s:%d: %s" % (p, i + 1, out))
                break
