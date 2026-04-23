// loader.js — Page loading overlay + image skeleton helpers
(function () {
  // ── 1. Inject loading overlay immediately ──────────────────────────────────
  const loader = document.createElement('div');
  loader.id = 'page-loader';
  loader.innerHTML = `
    <div class="loader-inner">
      <div class="loader-spinner"></div>
      <div class="loader-logo">PokéFeet</div>
    </div>`;
  document.documentElement.appendChild(loader);

  function hideLoader() {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 500);
  }

  // Hide once everything is loaded (or after max 2.5 s as safety net)
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    hideLoader();
  }
  window.addEventListener('load', finish);
  setTimeout(finish, 2500);

  // ── 2. Skeleton shimmer on pokemon images while src is loading ─────────────
  function setupImageSkeleton(img) {
    const wrap = img.closest('.pokemon-image');
    if (!wrap) return;
    wrap.classList.add('img-loading');
    img.addEventListener('load', () => wrap.classList.remove('img-loading'), { once: true });
    img.addEventListener('error', () => wrap.classList.remove('img-loading'), { once: true });
    // If img already loaded (cached) remove immediately
    if (img.complete && img.naturalWidth > 0) wrap.classList.remove('img-loading');
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.pokemon-image img').forEach(setupImageSkeleton);
      // Also watch for dynamically added images via MutationObserver
      watchForNewImages();
    });
  } else {
    document.querySelectorAll('.pokemon-image img').forEach(setupImageSkeleton);
    watchForNewImages();
  }

  function watchForNewImages() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('.pokemon-image img')) {
            setupImageSkeleton(node);
          }
          node.querySelectorAll && node.querySelectorAll('.pokemon-image img').forEach(setupImageSkeleton);
        });
        // Handle src changes on existing images
        if (m.type === 'attributes' && m.attributeName === 'src' && m.target.closest && m.target.closest('.pokemon-image')) {
          setupImageSkeleton(m.target);
        }
      });
    });
    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src']
    });
  }
})();
