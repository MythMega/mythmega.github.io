/**
 * IllagerQuestTypes - The objectives an Illager quest can ask for.
 *
 * WHY THIS FILE LIVES IN THE GAME
 * The list is needed in three places: the game (`IllagerQuestManager` keys the progress of a quest
 * by its type), the `data/illager-shop` rule of the linter (a quest whose `Type` is unknown is
 * refused) and `admin/data_editors.py` (the form offers it as a dropdown). Three copies meant a
 * type added to the game could be silently rejected by the linter. This module is the single copy:
 * the game imports it, the rule imports it and the Python server reads it.
 *
 * It lives under `js/` rather than under `tools/` because the APPLICATION imports it: a runtime
 * module must be served with a JavaScript MIME type, cacheable by the service worker and shipped
 * with the game, none of which is true of the development tooling.
 *
 * ADDING A TYPE
 *   1. add it here, with the exact string the data files write;
 *   2. publish its progress event where the action happens (`EventBus`);
 *   3. route it in `js/app.js` for the "Go there" button.
 */

/** Objective a quest asks the player to reach, keyed by the name the code uses. */
export const ILLAGER_QUEST_TYPES = Object.freeze({
  OPEN_BOOSTER_DAILY: 'OpenBooster_Daily',
  DAILY_REWARD_CLAIM: 'DailyRewardClaim',
  SELL_CARD: 'SellCard',
  MINE_BLOCK: 'MineBlock',
  SHARE_BINDER: 'ShareBinder',
  MINE_PICK_CARDS: 'MinePickCards',
  DOWNLOAD_PROFILE_CARD: 'DownloadProfilCard',
  OPEN_CHANGELOG: 'OpenChangelog',
  CHANGE_SELECTED_TITLE: 'ChangeSelectedTitle',
  DOWNLOAD_SAVE_BACKUP: 'DownloadCurrentSaveBackup',
  CUSTOM_WEBSITE_OPEN: 'CustomWebsiteOpen',
  ADD_FRIEND: 'AddFriend',
  TRADE_COMPLETE: 'TradeComplete',
  UPLOAD_SAVE: 'UploadSave',
  CHANGE_CARD_RENDERING: 'ChangeCardRendering',
  PUBLISH_PROFILE_CARD: 'PublishProfilCard',
});

export default ILLAGER_QUEST_TYPES;
