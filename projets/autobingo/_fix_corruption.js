const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "js", "visual", "bingoGridRenderer.js");
let c = fs.readFileSync(f, "utf8");

// Fix line 768: "        },   }, 150);" should be "        },"
// And add the missing _openSearchModal method header
// The corruption from _fix_badge.js ate the method header

const corrupted = "        },   }, 150);\n            });\n\n            // Random item button";
const fixed = "        },\n\n        /**\n         * Open the search modal for replacing an item\n         */\n        _openSearchModal(index) {\n            // Random item button";

if (c.includes(corrupted)) {
  c = c.replace(corrupted, fixed);
  fs.writeFileSync(f, c, "utf8");
  console.log("Fixed corruption!");
} else {
  console.log("Pattern not found!");
}

// Verify
c = fs.readFileSync(f, "utf8");
const lines = c.split("\n");
for (let i = 765; i < 785 && i < lines.length; i++) {
  console.log((i + 1) + ": " + lines[i]);
}
