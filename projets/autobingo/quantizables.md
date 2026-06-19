# Quantizable System - Documentation Technique

## Overview

The quantizable system allows bingo grids to display a **quantity number** on each cell (e.g., "64 Iron Ore"). This is useful for resource-based games like Satisfactory where items have stack sizes or specific amounts.

## Enabling Quantization

A dataset JSON file must have `"Quantizable": true` at the root level, plus optional `DefaultQuantities`:

```json
{
  "Name": "Satisfactory - All Items - 1.1",
  "Category": "Satisfactory",
  "Subcategory": "Satisfactory - 1.1",
  "Quantizable": true,
  "DefaultQuantities": {
    "Max": 100,
    "Min": 4
  },
  "Items": [...]
}
```

## Quantity Resolution Logic

When generating a random quantity for a cell, the system uses this priority:

1. **Item-level** `Quantity.Min` / `Quantity.Max` (highest priority)
2. **Dataset-level** `DefaultQuantities.Min` / `DefaultQuantities.Max`
3. **Fallback** `Min: 1, Max: 999`

### Examples

| Item Quantity | DefaultQuantities | Resolved Min | Resolved Max |
|---|---|---|---|
| `{ "Max": 64 }` | `{ "Min": 4, "Max": 100 }` | 4 | 64 |
| `{ "Min": 16 }` | `{ "Min": 4, "Max": 100 }` | 16 | 100 |
| _(none)_ | `{ "Min": 4, "Max": 100 }` | 4 | 100 |
| _(none)_ | _(none)_ | 1 | 999 |

## UI Behavior

### Quantity Badge
- Displayed **top-left** of each cell in a **red badge**
- Font size auto-adjusts: if the number text exceeds 50% of cell width, font size shrinks
- **Hidden** when quantity ≤ 1 (to avoid clutter for items where quantity is irrelevant)

### Editing Quantity (cell-switch button)
On quantizable datasets, clicking the **cell-switch button** (top-right) opens an **inline number input** instead of the replace-item modal:

- Click cell-switch → input field appears top-left
- Press **Enter** or **blur** → quantity saved
- Press **Escape** → input cancelled
- Input commits to URL

### Randomize Quantities Button
A **"Randomize Quantities"** button appears in the controls bar (only for quantizable datasets). It re-rolls quantities for all cells based on the resolution logic above.

## URL Encoding

Quantities are stored as a **base64-encoded** URL parameter `quantities`:

- Format: `btoa("12;5;100;...")` – semicolon-separated integers
- Each integer corresponds to the cell at that index
- Value `0` means no quantity (treated as ≤ 1 on display)

### Full URL Example
```
bingo.html?id=Satisfactory - All Items - 1.1&size=5&controls=000&items=BAww...&quantities=MTI7NTsxMDA7...
```

## Key Files Modified

| File | Change |
|------|--------|
| `js/entity/DatasetDefinition.js` | Added `quantizable`, `defaultQuantities` |
| `js/entity/DatasetItem.js` | Added `quantity` (per-item Min/Max override) |
| `js/entity/BingoCell.js` | Added `quantity` field |
| `js/business/datasetManager.js` | Reads `Quantizable`/`DefaultQuantities` from data JSON |
| `js/business/bingoGameManager.js` | Quantity generation, randomizing, encoding/decoding |
| `js/visual/bingoGridRenderer.js` | Quantity badge, inline input, Randomize Quantities button |
| `styles/bingo.css` | `.cell-quantity-badge`, `.cell-quantity-input` |
| `translations/en.json` | `bingo.randomize_quantities` |
| `translations/fr.json` | `bingo.randomize_quantities` (French) |

## Notes

- `randomizeOrder()` preserves quantities with their items (items and quantities are shuffled together as pairs)
- `randomizeItems()` re-rolls both items AND quantities
- The cell-switch button **only shows quantity input if the dataset is quantizable**; otherwise it opens the original replace-item modal