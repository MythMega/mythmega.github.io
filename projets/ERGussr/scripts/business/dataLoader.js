/**
 * DataLoader — loads all Dataset-*.json files and exposes the merged item list.
 */
import { Item } from "../entity/Item.js";

const DATASETS = [
  { file: "./data/Dataset-goods.json",       category: "goods" },
  { file: "./data/Dataset-weapon.json",      category: "weapon" },
  { file: "./data/Dataset-armor.json",       category: "armor" },
  { file: "./data/Dataset-magic.json",       category: "magic" },
  { file: "./data/Dataset-accessories.json", category: "accessories" }
];

/** @type {Item[]} */
let allItems = [];
let loaded = false;

/**
 * Loads all datasets. Subsequent calls return the cached result.
 * @returns {Promise<Item[]>}
 */
export async function loadAllItems() {
  if (loaded) return allItems;
  console.log("[DataLoader] Loading all datasets...");
  const results = await Promise.allSettled(
    DATASETS.map(ds => loadDataset(ds.file, ds.category))
  );
  allItems = [];
  for (const res of results) {
    if (res.status === "fulfilled") {
      allItems = allItems.concat(res.value);
    } else {
      console.error("[DataLoader] Failed to load a dataset:", res.reason);
    }
  }
  console.log(`[DataLoader] Total items loaded: ${allItems.length}`);
  loaded = true;
  return allItems;
}

/**
 * Loads a single dataset file and maps raw objects to Item instances.
 * @param {string} file
 * @param {string} category
 * @returns {Promise<Item[]>}
 */
async function loadDataset(file, category) {
  const resp = await fetch(file);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${file}`);
  const raw = await resp.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn(`[DataLoader] Dataset empty or not an array: ${file}`);
    return [];
  }
  const allRaw = raw.map(r => new Item(
    r.ID,
    r.NameFR || "",
    r.NameEN || "",
    r.Desc1FR || "",
    r.Desc1EN || "",
    r.Desc2FR || "",
    r.Desc2EN || "",
    r.Desc3FR || "",
    r.Desc3EN || "",
    r.PictureURL || "",
    category
  ));
  // Quality filter: discard items with no description in either language
  const withDesc = allRaw.filter(item => item.desc1FR.trim() && item.desc1EN.trim());

  // RUSTINE — à retirer une fois le jeu de données corrigé :
  // Certains noms contiennent des "\n" (données malformées), ce qui casse l'autocomplete et l'affichage.
  const items = withDesc.filter(item => !item.nameFR.includes("\n") && !item.nameEN.includes("\n"));
  const skippedName = withDesc.length - items.length;
  if (skippedName > 0) {
    console.warn(`[DataLoader] RUSTINE: Skipped ${skippedName} item(s) with "\\n" in name in ${file}`);
  }

  const skipped = allRaw.length - items.length;
  if (skipped > 0) {
    console.warn(`[DataLoader] Skipped ${skipped} item(s) with no Desc1 (FR or EN) in ${file}`);
  }
  console.log(`[DataLoader] Loaded ${items.length} usable items from ${file} (${allRaw.length} total)`);
  return items;
}

/** Returns cached items (must call loadAllItems first). */
export function getItems() {
  return allItems;
}
