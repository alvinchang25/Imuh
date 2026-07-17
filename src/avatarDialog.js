/**
 * Floating avatar dialog — a non-modal <dialog> hosting <sv-presenter>.
 *
 * Non-modal (dialog.show(), not showModal()) so the broadcast page behind it
 * stays interactive. The title bar drags the dialog; the close button hides it
 * and reveals a HUD toggle to reopen. Closing only hides the visuals — the
 * presenter keeps running (audio included).
 */

/**
 * @param {{ dialog: HTMLDialogElement, bar: HTMLElement,
 *           closeBtn: HTMLButtonElement, toggleBtn: HTMLButtonElement }} els
 * @returns {{ open: () => void, close: () => void }}
 */
export function createAvatarDialog({ dialog, bar, closeBtn, toggleBtn }) {
  const open = () => {
    if (!dialog.open) dialog.show();
    toggleBtn.hidden = true;
  };

  closeBtn.addEventListener("click", () => dialog.close());
  toggleBtn.addEventListener("click", open);
  // 'close' also fires for non-button paths (e.g. dialog.close() elsewhere),
  // so the reopen toggle never gets stranded hidden.
  dialog.addEventListener("close", () => {
    toggleBtn.hidden = false;
  });

  // Drag by the title bar. The dialog is CSS-anchored right/bottom; on first
  // drag we switch to left/top so the position tracks the pointer.
  bar.addEventListener("pointerdown", (e) => {
    if (e.target === closeBtn) return;
    const rect = dialog.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    dialog.style.inset = `${rect.top}px auto auto ${rect.left}px`;
    bar.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const left = Math.min(
        Math.max(ev.clientX - offsetX, 0),
        window.innerWidth - rect.width,
      );
      const top = Math.min(
        Math.max(ev.clientY - offsetY, 0),
        window.innerHeight - bar.offsetHeight,
      );
      dialog.style.inset = `${top}px auto auto ${left}px`;
    };
    const onUp = () => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
  });

  return { open, close: () => dialog.close() };
}
