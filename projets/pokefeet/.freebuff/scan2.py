import os, re, sys

FR = r"(Échec|Erreur|Déjà|Aucun|Aucune|Impossible|Terminé|Partag|Points|Rafraîchir|Par défaut|Défaut|Bloqu|débloqu|Copié|Rapport|Veuillez|Chargement|Trouvé|attention|vilain|modifié|enregistré|suppression|Révélé|Passé|découvert|Nouveau)"

QS = re.compile(r"(['\"`])((?:[^'\"`\\\n]|\\.)*?)\1")

TARGETS = sys.argv[1:]

for p in TARGETS:
    lines = open(p, encoding='utf-8', errors='ignore').read().split('\n')
    for i, line in enumerate(lines):
        if 'console.' in line:
            continue
        for m in QS.finditer(line):
            s = m.group(2)
            if not s or len(s) < 4:
                continue
            if not re.search(FR, s):
                continue
            if not re.search(r"[aeiouyà-ÿ]", s.lower()):
                continue
            if re.match(r"^[a-zA-Z]*Score$|^[a-zA-Z]*El$|^Notif", s):
                continue
            out = line.strip().encode('ascii', 'replace').decode('ascii')
            print("%s:%d: %s" % (p, i + 1, out[:150]))
            break
