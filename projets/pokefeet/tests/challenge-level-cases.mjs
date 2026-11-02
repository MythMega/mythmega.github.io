/**
 * Cas de test navigateur : niveau du joueur dans les défis.
 *
 * Le niveau affiché par le profil vient de la courbe de js/core/xp.js. Les
 * prérequis de niveau des défis doivent lire exactement la même courbe, sans
 * quoi un défi reste verrouillé alors que le profil annonce le niveau atteint.
 */

const CHALLENGE_LEVEL_MATCHES_PROFILE = {
  name: 'défis — niveau du joueur identique à celui du profil',
  page: '/list_challenges.html',
  settle: 'typeof ChallengeManager !== "undefined" && typeof PokefeetXP !== "undefined"',
  checks: [
    {
      name: 'le niveau lu par les défis est celui de la courbe d’XP',
      expression: '(async () => { const shown = await ChallengeManager.getPlayerLevel(); const expected = PokefeetXP.getLevel(await PokefeetXP.computeTotalXP()); return { ok: shown === expected, detail: "défis " + shown + " / courbe " + expected }; })()'
    },
    {
      // L’ancienne formule (Math.floor(XP / 100) + 1) donnait le même résultat
      // tant que le joueur avait peu d’XP : ce contrôle vérifie la délégation
      // elle-même, pas seulement la valeur affichée.
      name: 'les défis demandent leur niveau à la courbe partagée',
      expression: '(async () => { const original = PokefeetXP.getLevel; let calls = 0; PokefeetXP.getLevel = function (xp) { calls += 1; return original.call(PokefeetXP, xp); }; try { await ChallengeManager.getPlayerLevel(); } finally { PokefeetXP.getLevel = original; } return { ok: calls > 0, detail: calls + " appel(s) à PokefeetXP.getLevel" }; })()'
    },
    {
      name: 'le prérequis de niveau d’un défi annonce ce même niveau',
      expression: '(async () => { const level = await ChallengeManager.getPlayerLevel(); const target = ChallengeManager.getAllChallenges().find(c => (c.Requirements || []).some(r => r.TypeRequirement === "level")); if (!target) return { ok: false, detail: "aucun défi avec prérequis de niveau" }; const requirement = target.Requirements.find(r => r.TypeRequirement === "level"); const result = await target.checkRequirement(requirement); return { ok: result.current === level && result.text.indexOf(String(level)) !== -1, detail: result.text + " (" + String(level) + " attendu)" }; })()'
    }
  ]
};

export const LEVEL_CASES = [CHALLENGE_LEVEL_MATCHES_PROFILE];
