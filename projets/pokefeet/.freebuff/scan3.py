import os, re

QS = re.compile(r"(['\"`])((?:[^'\"`\\\n]|\\.)*?)\1")
FRWORDS = re.compile(
    r"\b(le|la|les|des|du|une?|est|pas|pour|dans|avec|sans|sur|Impossible|Aucun|Aucune|"
    r"Erreur|Termin|chec|D.j.|Fichier|Import|Export|sauvegard|fichier|cr.dit|supression|suppression)\b",
    re.I,
)

files = []
for root, dirs, fs in os.walk('.'):
    if '.git' in root or 'node_modules' in root:
        continue
    for f in fs:
        if f.endswith('.js'):
            files.append(os.path.join(root, f))

for p in sorted(files):
    lines = open(p, encoding='utf-8', errors='ignore').read().split('\n')
    for i, line in enumerate(lines):
        if 'console.' in line or 'Translator' in line:
            continue
        for m in QS.finditer(line):
            s = m.group(2)
            if len(s) < 4:
                continue
            if re.match(r"^[a-z0-9_.\-/#]+$", s):
                continue
            if re.search(r"^https?:|\.(png|jpg|json|css|html|js)$", s):
                continue
            accented = any(ord(c) > 127 for c in s)
            if accented or FRWORDS.search(s):
                out = line.strip().encode('ascii', 'replace').decode('ascii')
                print("%s:%d: %s" % (p, i + 1, out[:140]))
                break
