import os
import re

pages = {
    'mc_buildit.html': ('Serveur Build It', 'Serveur Minecraft survie privé whitelisté Build It Saison 5 — Découvrez le serveur survie Minecraft de MythMega.'),
    'mc_hyperlapse.html': ('Hyperlapses', 'Hyperlapses Minecraft des constructions sur le serveur Build It — Vidéos accélérées de builds épiques.'),
    'mc_javarock.html': ('Serveur JavaRock', 'Serveur Minecraft JavaRock de MythMega — Découvrez les aventures et constructions du serveur JavaRock.'),
    'mc_javarock_s1.html': ('JavaRock Saison 1', 'Serveur Minecraft JavaRock Saison 1 — Les débuts de l\'aventure JavaRock de MythMega.'),
    'mc_javarock_s2.html': ('JavaRock Saison 2', 'Serveur Minecraft JavaRock Saison 2 — La suite des aventures Minecraft de MythMega.'),
    'peak.html': ('Peak & Records', 'Records et pics de viewers de MythMega sur Twitch — Audience, followage et statistiques.'),
    'planning.html': ('Planning', 'Planning des streams Twitch de MythMega — Retrouvez le programme des lives à venir.'),
    'giveaway.html': ('Giveaway', 'Giveaway et concours de MythMega — Participez pour gagner des récompenses exclusives.'),
    'politique_de_donnees.html': ('Politique de Données', 'Politique de confidentialité et de protection des données de MythMega (jmdev).'),
    'music_platforms.html': ('Plateformes musicales', 'Retrouvez la musique de MythMega sur toutes les plateformes : Spotify, Apple Music, YouTube Music et plus.'),
    'twitch_integrated.html': ('Twitch (intégré)', 'Stream Twitch de MythMega intégré sur la page — Regardez les lives directement depuis le site.'),
    'soft_MCCare.html': ('Suite MCCareSuit', 'Suite d\'outils pour streamers Minecraft par MythMega — Outils de modération et d\'automatisation.'),
    'soft_AutoVodMaker.html': ('AutoVODMaker', 'Outil automatisé de création de VODs pour streamers par MythMega — Générez vos VODs simplement.'),
    'porfolio.html': ('Portfolio', 'Portfolio des projets de MythMega — Pokefeet, Pokegg, Pokiéce, AutoBingo, Nuzloverlay et plus.'),
    'social_youtube.html': ('YouTube', 'Chaîne YouTube de MythMega — Vidéos, VODs et contenus gaming. Abonnez-vous !'),
    'social_discord.html': ('Discord', 'Serveur Discord de MythMega — Rejoignez la communauté pour discuter et jouer ensemble.'),
    'social_bluesky.html': ('Bluesky', 'Bluesky de MythMega — Suivez l\'actualité et les annonces sur Bluesky.'),
    'social_instagram.html': ('Instagram', 'Instagram de MythMega — Photos, coulisses et moments de vie.'),
}

for filename, (title_suffix, desc) in pages.items():
    if not os.path.isfile(filename):
        print(f'Skipping {filename}: not found')
        continue
    
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find the title tag to get the actual page title
    m = re.search(r'<title>(.*?)</title>', content)
    if not m:
        print(f'Skipping {filename}: no title found')
        continue
    page_title = m.group(1)
    
    # Check if OG already exists
    if 'og:image' in content:
        print(f'Skipping {filename}: already has OG tags')
        continue
    
    # Build the OG meta block
    url_path = filename
    og_block = f'''    <meta name="description" content="{desc}">
    <link rel="canonical" href="https://web.jmdev.fr/{url_path}">
    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="MythMega &mdash; jmdev">
    <meta property="og:url" content="https://web.jmdev.fr/{url_path}">
    <meta property="og:title" content="{page_title}">
    <meta property="og:description" content="{desc}">
    <meta property="og:image" content="https://web.jmdev.fr/assets/icon.png">
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="{page_title}">
    <meta name="twitter:description" content="{desc}">'''
    
    # Insert after the title tag line
    content = content.replace(f'<title>{page_title}</title>', f'<title>{page_title}</title>\n{og_block}')
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'✓ Updated {filename}')

print('\nDone!')