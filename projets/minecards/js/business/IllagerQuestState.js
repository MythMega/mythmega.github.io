/**
 * IllagerQuestState - the shape of the Illager quest save.
 *
 * Reference: `js/business/IllagerQuestManager.js` (the writer) and
 * `js/business/TrophyManager.js` (the reader of the quest experience).
 *
 * The quests keep their own `user_state` entry rather than sharing the one of the Illager Shop: the
 * shop stores what the player OWNS (balances, purchases), while a quest stores how far the player
 * is inside a dated objective. Splitting them keeps a quest write from touching a balance, and it
 * lets the experience of the trophies add the quest XP without loading the whole quest manager.
 *
 * WHAT IS PERSISTED (`user_state["illagerQuests"]`)
 *   `progress`       : `{ [questId]: { count, claimedAt } }` - the counter of each quest, clamped to
 *                      its requirement, and the instant it was claimed (null while it is not);
 *   `experience`     : the XP granted by the claimed quests, added to the derived experience of the
 *                      profile (`TrophyManager.computeExperience`);
 *   `lastTotalMined` : the `totalMined` counter of the mine the last time a block was announced,
 *                      used to turn the absolute counter of the mine into a quest delta.
 *   `announced`      : the ids of the quests whose AVAILABILITY was already announced. A quest that
 *                      just opened is told once, and a reload never repeats it.
 *
 * This module is dependency-free on purpose: the trophy manager imports it, and it must never drag
 * the quest manager (and its Sparks, shop and mine imports) into the trophy graph.
 */

/** Key of the `user_state` entry holding the quest progress. */
export const ILLAGER_QUESTS_STATE_KEY = 'illagerQuests';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Normalizes a raw quest state.
 *
 * Anything malformed reads as its default, so a save written before the quests existed (or a
 * hand-edited one) starts with no progress instead of throwing.
 *
 * @param {unknown} raw - Value read from `user_state["illagerQuests"]`.
 * @returns {{progress: Record<string, {count: number, claimedAt: string|null}>, experience: number,
 *   lastTotalMined: number|null, announced: string[]}} The normalized state.
 */
export function normalizeQuestState(raw) {
  const source = isRecord(raw) ? raw : {};

  const progress = {};
  if (isRecord(source.progress)) {
    Object.entries(source.progress).forEach(([id, value]) => {
      if (typeof id !== 'string' || id.trim() === '' || !isRecord(value)) return;
      const count = Math.trunc(Number(value.count));
      const claimedAt = typeof value.claimedAt === 'string' && value.claimedAt.trim() !== ''
        ? value.claimedAt
        : null;
      progress[id] = {
        count: Number.isFinite(count) && count > 0 ? count : 0,
        claimedAt,
      };
    });
  }

  const experience = Math.trunc(Number(source.experience));
  const lastTotalMined = Math.trunc(Number(source.lastTotalMined));

  const announced = Array.isArray(source.announced)
    ? [
        ...new Set(
          source.announced.filter((id) => typeof id === 'string' && id.trim() !== '')
        ),
      ]
    : [];

  return {
    progress,
    experience: Number.isFinite(experience) && experience > 0 ? experience : 0,
    lastTotalMined:
      source.lastTotalMined !== null && source.lastTotalMined !== undefined && Number.isFinite(lastTotalMined) && lastTotalMined >= 0
        ? lastTotalMined
        : null,
    announced,
  };
}

/**
 * Reads the XP granted by the claimed quests.
 *
 * @param {unknown} raw - Value read from `user_state["illagerQuests"]`.
 * @returns {number} The XP, 0 when nothing was claimed yet.
 */
export function readQuestExperience(raw) {
  return normalizeQuestState(raw).experience;
}
