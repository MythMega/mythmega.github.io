"""Accès unifié aux données Pokefeet éclatées.

Chaque jeu de données vit dans son dossier `data/<dossier>/` et son manifeste
`data/<nom>files.json` liste les fichiers à charger, exactement comme
`data/monsfiles.json` le fait pour `data/mons/`. Les outils Python (analyse,
vérification, mise à jour) lisent et réécrivent les fichiers via ce module, sans
jamais connaître le découpage ni le nom des fichiers.

Utilisation :

    import poke_data

    challenges = poke_data.load('bonus_challenges')      # liste fusionnée
    credits    = poke_data.load('credits')               # dictionnaire fusionné
    poke_data.write('cosmetics', catalogue_modifie)      # réécrit le découpage

    python poke_data.py                                  # renormalise tout

Jeux de données disponibles : trophies, rewards, bonus_challenges, cosmetics,
credits.
"""

import json
import os
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
INDENT = 4


def slug(text):
    """Transforme un libellé (« Main Games ») en nom de fichier (« main_games »)."""
    out = []
    previous_separator = True
    for char in str(text).lower():
        if char.isalnum():
            out.append(char)
            previous_separator = False
        elif not previous_separator:
            out.append('_')
            previous_separator = True
    return ''.join(out).strip('_')


# ── Règles de découpage ────────────────────────────────────────
# Chaque règle range une entrée dans un « morceau » (part) nommé ; le nom du
# morceau devient le nom du fichier JSON dans le dossier du jeu de données.

def trophy_part(trophy):
    """Trophées : Pokédex, progression, générations, types."""
    mode = (trophy.get('Obtention_Method') or {}).get('Mode', '')
    if mode == 'Dex_Count':
        return 'dex'
    if mode == 'Full_Generation_Register':
        return 'generations'
    if mode == 'Type_Registered':
        return 'types'
    return 'progress'


def reward_part(reward):
    """Récompenses : par palier de niveau, du premier au dernier."""
    level = int(reward.get('Level') or 0)
    if level <= 15:
        return 'levels_01_15'
    if level <= 45:
        return 'levels_20_45'
    if level <= 75:
        return 'levels_50_75'
    return 'levels_80_100'


def challenge_part(challenge):
    """Défis bonus : par onglet (Main Games, Collection, Strategy, ...)."""
    return slug(challenge.get('Tab') or 'Challenge')


def cosmetic_part(cosmetic):
    """Cosmétiques : par type (bg_/btn_) puis par catégorie (Shop, Games, ...)."""
    kind = 'btn' if str(cosmetic.get('Type') or '').endswith('Buttons') else 'bg'
    cat = cosmetic.get('Cat')
    return kind + '_' + (slug(cat) if cat else 'misc')


# Correspondance des clés du dictionnaire de crédits vers les fichiers.
CREDITS_KEYS = OrderedDict((
    ('Credits', 'members'),
    ('TranslationsFR', 'translations_fr'),
    ('TranslationsEN', 'translations_en'),
))

SETS = OrderedDict((
    ('trophies', {
        'dir': 'trophies',
        'manifest': 'trophiesfiles.json',
        'shape': 'list',
        'part': trophy_part,
    }),
    ('rewards', {
        'dir': 'rewards',
        'manifest': 'rewardsfiles.json',
        'shape': 'list',
        'part': reward_part,
    }),
    ('bonus_challenges', {
        'dir': 'bonus_challenges',
        'manifest': 'bonus_challengesfiles.json',
        'shape': 'list',
        'part': challenge_part,
    }),
    ('cosmetics', {
        'dir': 'cosmetics',
        'manifest': 'cosmeticsfiles.json',
        'shape': 'list',
        'part': cosmetic_part,
    }),
    ('credits', {
        'dir': 'credits',
        'manifest': 'creditsfiles.json',
        'shape': 'dict',
        'part': None,
    }),
))


def manifest_path(name):
    spec = SETS[name]
    return os.path.join(HERE, spec['manifest'])


def parts_dir(name):
    spec = SETS[name]
    return os.path.join(HERE, spec['dir'])


def part_file(name, part):
    spec = SETS[name]
    return os.path.join(HERE, spec['dir'], part + '.json')


def split(name, data):
    """Range `data` dans un OrderedDict {morceau: contenu du fichier}."""
    spec = SETS[name]
    if spec['shape'] == 'dict':
        groups = OrderedDict()
        for key, part in CREDITS_KEYS.items():
            if key in data:
                groups[part] = {key: data[key]}
        extra = [key for key in data if key not in CREDITS_KEYS]
        if extra:
            raise ValueError('clés inconnues dans %s : %s' % (name, ', '.join(extra)))
        return groups

    groups = OrderedDict()
    for item in data:
        part = spec['part'](item)
        if part not in groups:
            groups[part] = []
        groups[part].append(item)
    return groups


def write(name, data):
    """Écrit le découpage de `data` et son manifeste. Retourne les fichiers écrits."""
    spec = SETS[name]
    groups = split(name, data)

    directory = parts_dir(name)
    os.makedirs(directory, exist_ok=True)

    written = []
    for part in sorted(groups):
        target = part_file(name, part)
        _dump(target, groups[part])
        written.append(os.path.relpath(target, HERE).replace(os.sep, '/'))

    manifest = os.path.join(HERE, spec['manifest'])
    _dump(manifest, [part + '.json' for part in sorted(groups)])
    written.append(os.path.relpath(manifest, HERE).replace(os.sep, '/'))

    return written


def read_manifest(manifest):
    """Liste des fichiers d'un manifeste (`monsfiles.json`, `trophiesfiles.json`, ...)."""
    with open(os.path.join(HERE, manifest), 'r', encoding='utf-8') as file:
        return json.load(file)


def load_manifest(manifest, directory):
    """Fusionne en une liste les fichiers JSON listés par un manifeste."""
    merged = []
    for entry in read_manifest(manifest):
        with open(os.path.join(HERE, directory, entry), 'r', encoding='utf-8') as file:
            merged.extend(json.load(file))
    return merged


def load(name):
    """Fusionne tous les fichiers listés par le manifeste, dans son ordre."""
    spec = SETS[name]
    parts = []
    for entry in files(name):
        with open(os.path.join(HERE, spec['dir'], entry), 'r', encoding='utf-8') as file:
            parts.append(json.load(file))

    if spec['shape'] == 'dict':
        merged = OrderedDict()
        for part in parts:
            for key, value in part.items():
                merged[key] = value
        return merged

    merged = []
    for part in parts:
        merged.extend(part)
    return merged


def files(name):
    """Liste des fichiers du jeu de données, telle qu'écrite dans le manifeste."""
    return read_manifest(SETS[name]['manifest'])


def _dump(path, payload):
    with open(path, 'w', encoding='utf-8', newline='\r\n') as file:
        json.dump(payload, file, ensure_ascii=False, indent=INDENT)
        file.write('\n')


if __name__ == '__main__':
    for set_name in SETS:
        data = load(set_name)
        count = len(data)
        written = write(set_name, data)
        print('%-18s %4d entrées -> %d fichiers' % (set_name, count, len(written) - 1))
