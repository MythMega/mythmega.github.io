// scripts/preview.js
// Keep preview stable and avoid forcing reloads that create overflow issues.
// The configurator sets iframe.src; here we ensure the iframe is visible and sized.

(function(){
  const iframe = document.getElementById('previewIframe');
  if(!iframe) return;

  // Ensure iframe uses full available space and doesn't overflow
  function fitIframe(){
    const container = iframe.parentElement;
    if(!container) return;
    // container computed height
    const rect = container.getBoundingClientRect();
    iframe.style.width = '100%';
    iframe.style.height = rect.height + 'px';
  }

  // Fit on load and on resize
  window.addEventListener('resize', fitIframe);
  window.addEventListener('load', fitIframe);

  // Observe container size changes (in case of responsive layout)
  const observer = new ResizeObserver(entries => {
    fitIframe();
  });
  observer.observe(iframe.parentElement);

  // Keep a gentle check to ensure src is not stuck to about:blank when user has provided a valid id
  let lastSrc = iframe.src;
  setInterval(()=>{
    if(iframe.src !== lastSrc){
      lastSrc = iframe.src;
      // no forced reload; just ensure sizing
      fitIframe();
    }
  }, 800);
})();
