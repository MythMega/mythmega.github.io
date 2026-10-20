// pwa.js — enregistrement du Service Worker Pokefeet
(function () {
  if (!('serviceWorker' in navigator)) return;

  const isLocalhost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';

  if (location.protocol !== 'https:' && !isLocalhost) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('sw.js', { scope: './' })
      .then(function (registration) {
        registration.addEventListener('updatefound', function () {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('pokefeet:pwa-update'));
            }
          });
        });
      })
      .catch(function (error) {
        console.warn('[PWA] Service Worker non enregistré :', error);
      });
  });
})();
