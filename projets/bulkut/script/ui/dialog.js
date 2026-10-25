/**
 * Native <dialog> helpers: backdrop click, close buttons, open/close.
 * @module ui/dialog
 */

/**
 * @param {HTMLDialogElement} dialog
 */
export function createDialogController(dialog) {
  if (!dialog) {
    return { open() {}, close() {}, isOpen: () => false, dialog: null };
  }

  dialog.addEventListener('click', (event) => {
    // A click on the ::backdrop targets the dialog itself.
    if (event.target === dialog) dialog.close();
  });

  for (const button of dialog.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => dialog.close());
  }

  return {
    dialog,
    open() {
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    isOpen() {
      return dialog.open;
    },
  };
}
