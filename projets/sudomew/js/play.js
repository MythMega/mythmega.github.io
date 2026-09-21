/* ============================================================
   Cat Logic Puzzle — play.js
   Choix de la difficulté (facile / moyen / difficile) et taille
   personnalisée (curseur 5×5 → 15×15) puis lancement de game.html.
   Le switch « Angry Cat Mode » (Mode Chat Fâché) ajoute la règle 3
   (les chats ne peuvent pas être autour d'un autre chat) via ?angry=1.
   ============================================================ */
(function (global) {
  'use strict';

  var App = global.CatApp;
  var MIN_SIZE = 5;
  var MAX_SIZE = 15;
  var DEFAULT_SIZE = 9;

  function startGame(size, difficulty, angry) {
    var url = 'game.html?size=' + size + '&difficulty=' + encodeURIComponent(difficulty);
    if (angry) url += '&angry=1';
    global.location.href = url;
  }

  function init() {
    var range = global.document.getElementById('sizeRange');
    var valueLabel = global.document.getElementById('sizeValue');
    var badge = global.document.getElementById('customBadge');
    var angrySwitch = global.document.getElementById('angrySwitch');
    var angryIcon = global.document.getElementById('angryIcon');
    var angryHelpBtn = global.document.getElementById('angryHelpBtn');
    var angryModal = global.document.getElementById('angryModal');
    var angryCloseBtn = global.document.getElementById('angryCloseBtn');

    function renderSize() {
      var size = App.clampInt(range.value, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
      if (valueLabel) valueLabel.textContent = App.t('grid_size', { size: size });
      if (badge) badge.textContent = size + '×' + size;
      var customButton = global.document.getElementById('customStart');
      if (customButton) customButton.setAttribute('data-size', String(size));
    }

    if (range) {
      range.value = String(DEFAULT_SIZE);
      range.addEventListener('input', renderSize);
      range.addEventListener('change', renderSize);
      renderSize();
    }

    /* Modale d'aide du Mode Chat Fâché (bouton « ? »). */
    if (angryHelpBtn && angryModal) {
      angryHelpBtn.addEventListener('click', function () { App.setModalOpen(angryModal, true); });
    }
    if (angryCloseBtn && angryModal) {
      angryCloseBtn.addEventListener('click', function () { App.setModalOpen(angryModal, false); });
    }
    if (angryModal) {
      angryModal.addEventListener('click', function (event) {
        if (event.target === angryModal) App.setModalOpen(angryModal, false);
      });
    }
    global.document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (angryModal && !angryModal.hidden) App.setModalOpen(angryModal, false);
    });

    /* Icône du mode : chat normal ↔ chat fâché selon l'état du switch. */
    if (angrySwitch && angryIcon) {
      angrySwitch.addEventListener('change', function () {
        angryIcon.src = angrySwitch.checked ? 'assets/img/cat_icon_angry.png' : 'assets/img/cat_icon.png';
      });
    }

    var buttons = global.document.querySelectorAll('[data-start]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        var size = App.clampInt(button.getAttribute('data-size'), MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
        var difficulty = button.getAttribute('data-difficulty') || 'custom';
        var angry = !!(angrySwitch && angrySwitch.checked);
        // Petit délai pour laisser le son de clic se terminer avant la navigation.
        App.playSound('click');
        global.setTimeout(function () { startGame(size, difficulty, angry); }, 110);
      });
    });
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
