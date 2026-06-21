# Dataset Creator — Documentation Technique

## Overview

The **Dataset Creator** (`creator.html`) is a standalone mini-application that allows users to **create or edit bingo dataset JSON files** directly in the browser. It supports the full dataset specification including quantizable mode.

## Page Architecture

- **File**: `creator.html`
- **Logic**: `js/visual/creatorApp.js`
- **Styles**: `styles/creator.css`

The creator reuses the existing AutoBingo infrastructure:
- ThemeManager (dark/light)
- TranslationManager (EN/FR)
- NavRenderer (navigation bar)
- DatasetManager (for importing existing datasets)

## Features

### Start from scratch or import
- **From scratch**: Open the page and start filling metadata + items
- **From existing dataset**: Use the "Import from" dropdown to load any dataset defined in `datasets.json`. All properties are loaded: Name, Category, Subcategory, Items, Quantizable, DefaultQuantities, per-item Quantity overrides.

### Metadata Section
- **Name** — Dataset display name
- **Category** — Grouping category
- **Subcategory** — Sub-grouping
- **Quantizable** — Checkbox to enable quantity support
- **Default Min / Max** — Only shown when quantizable is checked

### Items Table
Each row contains:

| Column | Description |
|--------|-------------|
| **Index** | Unique identifier. Auto-suggested from English name (lowercase, spaces → hyphens) |
| **Name FR** | French name |
| **Name EN** | English name |
| **Picture** | Image URL. Live-validated on input change |
| **Image** | Status icon (✓ valid, ✗ invalid, ⟳ checking, ? pending) |
| **Quantity** | Mode selector (only if quantizable): Default / Unique (1) / Custom |
| **Q.Min / Q.Max** | Min/Max values (only in Custom mode, editable only when Custom is selected) |
| **Status** | Shows ✓ OK when item has at least one name + valid image |
| **Delete** | Remove item (at least 1 item is always kept) |

### Image Validation
When the Picture URL is modified, the app attempts to load the image in the background via `new Image()`. The result is cached per URL:

- **✓** Green — Image loaded successfully
- **✗** Red — Image failed to load
- **⟳** Orange — Checking in progress
- **?** — No URL entered yet

### Floating Counter (top-right)
Displays `complete/total valid items` dynamically. Updates as you type.

Contains a **Download JSON** button that:
1. Builds the final dataset object
2. Generates a JSON file (formatted with 2-space indent)
3. Triggers a download with filename derived from the dataset name

### Quantizable Logic in JSON Export

When `Quantizable` is enabled:

- **Default mode**: No per-item Quantity — uses dataset-level `DefaultQuantities`
- **Unique mode**: Sets `Quantity: { "Min": 1, "Max": 1 }`
- **Custom mode**: Sets `Quantity: { "Min": <value>, "Max": <value> }` if different from defaults
- Items with no name (neither FR nor EN) are excluded from export

## JSON Output Example

```json
{
  "Name": "My Custom Dataset",
  "Category": "Games",
  "Subcategory": "RPG",
  "Quantizable": true,
  "DefaultQuantities": {
    "Min": 1,
    "Max": 64
  },
  "Items": [
    {
      "Index": "iron-sword",
      "Name_FR": "Épée en fer",
      "Name_EN": "Iron Sword",
      "PictureMain": "https://example.com/iron_sword.png",
      "Quantity": {
        "Min": 1,
        "Max": 1
      }
    },
    {
      "Index": "health-potion",
      "Name_FR": "Potion de vie",
      "Name_EN": "Health Potion",
      "PictureMain": "https://example.com/health_potion.png"
    }
  ]
}
```

## Key Implementation Details

- `CreatorApp._buildJson()` — Constructs the final JSON object. Items without names are filtered out. Quantity fields only appear when necessary.
- `CreatorApp._checkImage(url, itemId)` — Validates image URLs asynchronously with caching in `_imgCache`.
- `CreatorApp._suggestIndex(name)` — Generates an index suggestion from the English name.
- `CreatorApp._updateUI()` — Re-renders only the items table section (not the whole page) for performance.