/* ============================================================
   Cat Logic Puzzle — settings.js
   Lecture et écriture des réglages (cookies) : langue, thème, sons.
   ============================================================ */
(function (global) {
  'use strict';

  var App = global.CatApp;

  function checkGroup(inputs, value) {
    Array.prototype.forEach.call(inputs, function (input) {
      input.checked = input.value === value;
    });
  }

  function bindGroup(inputs, onChange) {
    Array.prototype.forEach.call(inputs, function (input) {
      input.addEventListener('change', function () {
        if (input.checked) onChange(input.value);
      });
    });
  }

  function init() {
    var langInputs = global.document.querySelectorAll('input[name="lang"]');
    var themeInputs = global.document.querySelectorAll('input[name="theme"]');
    var soundInputs = global.document.querySelectorAll('input[name="sound"]');

    checkGroup(langInputs, App.getLang());
    checkGroup(themeInputs, App.getTheme());
    checkGroup(soundInputs, App.isSoundOn() ? 'on' : 'off');

    bindGroup(langInputs, function (value) {
      App.setLang(value);
      App.translatePage(global.document); // la page se traduit immédiatement
      App.toast(App.t('saved'));
    });

    bindGroup(themeInputs, function (value) {
      App.setTheme(value);
      App.toast(App.t('saved'));
    });

    bindGroup(soundInputs, function (value) {
      var on = value === 'on';
      App.setSound(on);
      if (on) App.playSound('click'); // confirmation sonore à l'activation
      App.toast(App.t('saved'));
    });
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);