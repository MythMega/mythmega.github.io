# Trophies — Structure & Obtention Methods

## Propriétés d’un trophée
- **Id** — Identifiant unique du trophée.  
- **Name_en / Name_fr** — Nom affiché du trophée (anglais / français).  
- **Desc_en / Desc_fr** — Brève description expliquant comment l’obtenir.  
- **XP** — Points d’expérience gagnés en débloquant le trophée.  
- **Obtention_Method** — Condition précise à remplir pour l’obtenir.  
- **Rarity** — Rareté du trophée (1 = commun → 4 = légendaire).  
- **Picture** — Chemin vers l’icône du trophée.  
- **Enabled** — Active ou désactive le trophée dans le jeu.

---

## Méthodes d’obtention

### **Dex_Count**
Débloqué en remplissant un certain nombre d’entrées Pokédex.  
→ *Value = nombre d’entrées requises.*

### **Daily_Count**
Débloqué en complétant un nombre donné de défis quotidiens.  
→ *Value = total de dailies complétés.*

### **Weekly_Count**
Débloqué en complétant un nombre donné de défis hebdomadaires.  
→ *Value = total de weeklies complétés.*

### **Marathon_Streak**
Débloqué en atteignant une série (streak) dans le mode Marathon.  
→ *Value = longueur de la série.*

### **Full_Generation_Register**
Débloqué en enregistrant tous les Pokémon d’une génération donnée via dailies ou weeklies.  
→ *Value = numéro de génération (1 à 9).*

---