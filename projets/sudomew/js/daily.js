/* ============================================================
   Cat Logic Puzzle — daily.js
   Grille du jour : chrono, récap de fin de partie et partage du résultat.
   S'appuie sur les événements exposés par game.js (CatGame.on).
   ============================================================ */
(function (global) {
  'use strict';

  var App = global.CatApp;
  var CatGame = global.CatGame;

  var startedAt = 0;
  var finishedAt = 0;
  var timerId = null;
  var dailyDate = null;
  var lastText = '';

  /* Durée lisible : M:SS, ou H:MM:SS au-delà d'une heure. */
  function formatDuration(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    function pad(value) { return (value < 10 ? '0' : '') + value; }
    return (hours > 0 ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(seconds);
  }

  /* Texte partagé : titre, mauvais placements, durée et lien de la page. */
  function buildShareText(date, size, mistakes, durationText, url) {
    var d = date || { year: 0, month: 0, day: 0 };
    return App.t('share_title', {
      size: size + '×' + size, day: d.day, month: d.month, year: d.year
    }) + '\n' +
      App.t('share_mistakes', { count: mistakes }) + '\n' +
      App.t('share_time', { duration: durationText }) + '\n' +
      App.t('share_footer', { url: url });
  }

  /* Copie de secours quand l'API presse-papiers n'est pas disponible
     (page ouverte en file://, navigateur ancien…). */
  function legacyCopy(text) {
    try {
      var area = global.document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      global.document.body.appendChild(area);
      area.select();
      var ok = global.document.execCommand ? global.document.execCommand('copy') : false;
      global.document.body.removeChild(area);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function setText(id, value) {
    var el = global.document.getElementById(id);
    if (el) el.textContent = value;
  }

  function tick() {
    setText('dailyTimer', formatDuration(Date.now() - startedAt));
  }

  function startTimer() {
    if (startedAt) return;   // le chrono part à l'affichage de la grille
    startedAt = Date.now();
    tick();
    timerId = global.setInterval(tick, 500);
  }

  function stopTimer() {
    if (timerId) global.clearInterval(timerId);
    timerId = null;
    if (!finishedAt) finishedAt = Date.now();
  }

  function showRecap(info) {
    var duration = startedAt ? (finishedAt || Date.now()) - startedAt : 0;
    var durationText = formatDuration(duration);
    lastText = buildShareText(dailyDate, info.size, info.removals, durationText, global.location.href);
    setText('resultTime', durationText);
    setText('resultMistakes', String(info.removals));
    setText('resultText', lastText);
  }

  function copyRecap() {
    if (!lastText) return;
    copyText(lastText).then(function (ok) {
      App.toast(App.t(ok ? 'copied' : 'copy_failed'), 2000);
    });
  }

  function init() {
    if (!CatGame || !CatGame.on) return;

    CatGame.on('ready', function (info) {
      if (info && info.date) dailyDate = info.date;
      startTimer();
    });

    CatGame.on('win', function (info) {
      stopTimer();
      showRecap(info);
    });

    var copyBtn = global.document.getElementById('copyResultBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyRecap);
  }

  global.CatDaily = {
    formatDuration: formatDuration,
    buildShareText: buildShareText,
    copyText: copyText
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
