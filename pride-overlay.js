/**
 * pride-overlay.js — Pride flag overlay for June
 * Displays a semi-transparent rainbow gradient over the entire viewport
 * during the month of June (Pride Month).
 *
 * Adjust OVERLAY_OPACITY below to control the intensity (0 = invisible, 1 = fully opaque).
 */
(function () {
  'use strict';

  // ── Intensity control ──────────────────────────────────────
  //  0.0 = invisible  →  1.0 = fully opaque
  const OVERLAY_OPACITY = 0.10;

  const now = new Date();
  // June is month 5 in JavaScript's 0‑indexed Date API
  if (now.getMonth() !== 5) return;

  const overlay = document.createElement('div');
  overlay.id = 'pride-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9998;pointer-events:none;' +
    'background:linear-gradient(180deg,' +
    `rgba(255,   0,   0,${OVERLAY_OPACITY}) 0%,`    +     /* red */
    `rgba(255, 165,   0,${OVERLAY_OPACITY}) 16.67%,` +    /* orange */
    `rgba(255, 255,   0,${OVERLAY_OPACITY}) 33.33%,` +    /* yellow */
    `rgba(  0, 128,   0,${OVERLAY_OPACITY}) 50%,`    +    /* green */
    `rgba(  0,   0, 255,${OVERLAY_OPACITY}) 66.67%,` +    /* blue */
    `rgba(128,   0, 128,${OVERLAY_OPACITY}) 83.33%,` +    /* indigo / purple */
    `rgba(238, 130, 238,${OVERLAY_OPACITY}) 100%`    +    /* violet */
    ');';

  // Insert as early as possible (before nav.js loader)
  document.documentElement.style.position = 'relative';
  document.documentElement.appendChild(overlay);

  // ── Pride colors on navbar brand & all h1 ──────────────────
  var rainGrad =
    'linear-gradient(0deg,' +
    'rgb(255,  0,  0),' +
    'rgb(255,  0,  0),' +
    'rgb(255,165,  0),' +
    'rgb(255,255,  0),' +
    'rgb(  0,128,  0),' +
    'rgb(0, 238, 255),' +
    'rgb(128,  0,128),' +
    'rgb(238,130,238),' +
    'rgb(238,130,238)' +
    ')';

  var style = document.createElement('style');
  style.textContent =
    '.navbar-brand,' +
    'h1 {' +
    '  background: ' + rainGrad + ' !important;' +
    '  -webkit-background-clip: text !important;' +
    '  background-clip: text !important;' +
    '  -webkit-text-fill-color: transparent !important;' +
    '}';
  document.head.appendChild(style);
})();