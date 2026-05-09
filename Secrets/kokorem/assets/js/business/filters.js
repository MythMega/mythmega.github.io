/* ============================================
   KOKORO — Filter chips (shop pages)
   Toggles .active on .filter-chip elements.
   ============================================ */
(function () {
  'use strict';

  function initFilters() {
    const chips = document.querySelectorAll('.filter-chip');
    if (!chips.length) return;

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', initFilters);
})();
