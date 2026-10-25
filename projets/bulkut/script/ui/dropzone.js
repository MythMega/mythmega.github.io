/**
 * Dropzone behaviour: click, keyboard, browse button and drag & drop.
 * @module ui/dropzone
 */

let globalGuardInstalled = false;

function installGlobalGuard() {
  if (globalGuardInstalled) return;
  globalGuardInstalled = true;
  // Prevent the browser from navigating to a file dropped outside a dropzone.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

/**
 * @param {object} options
 * @param {HTMLElement} options.zone
 * @param {HTMLInputElement} options.input
 * @param {(files: File[]) => void} options.onFiles
 */
export function setupDropzone({ zone, input, onFiles }) {
  installGlobalGuard();

  const browse = () => input.click();

  zone.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input')) return;
    browse();
  });

  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      browse();
    }
  });

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) onFiles(files);
  });

  let depth = 0;

  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth += 1;
    zone.classList.add('is-dragover');
  });

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('is-dragover');
  });

  zone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove('is-dragover');
  });

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    zone.classList.remove('is-dragover');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });
}
