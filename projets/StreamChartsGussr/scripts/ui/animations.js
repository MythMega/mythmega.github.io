/**
 * Micro-animations CSS : on ajoute une classe le temps de l'animation puis
 * on la retire à la fin (le reflow force la relance à chaque appel).
 */
import { formatNumber } from './i18n.js';

const animationFrameHandles = new WeakMap();

export function play(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth; // reflow : relance la keyframe
  node.classList.add(className);

  // Nettoyage automatique à la fin de l'animation : évite l'accumulation
  // de classes et garantit que chaque appel relance proprement l'effet.
  const cleanup = () => node.classList.remove(className);
  node.addEventListener('animationend', cleanup, { once: true });
}

export const shake = (node) => play(node, 'anim-shake');
export const pop = (node) => play(node, 'anim-pop');
export const pulse = (node) => play(node, 'anim-pulse');
export const glow = (node) => play(node, 'anim-glow');

/** Révélation douce avec léger délai cumulé pour les listes. */
export function revealIndexed(node, index) {
  if (!node) return;
  node.style.animationDelay = `${Math.min(index * 55, 420)}ms`;
  play(node, 'reveal-item');
}

/** Décompte d'un nombre de 0 vers sa valeur (easing cubique). */
export function countUp(node, target, { digits = 1, duration = 900 } = {}) {
  if (!node) return;
  if (animationFrameHandles.has(node)) {
    cancelAnimationFrame(animationFrameHandles.get(node));
  }

  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = formatNumber(target * eased, digits);
    if (progress < 1) {
      animationFrameHandles.set(node, requestAnimationFrame(tick));
    } else {
      node.textContent = formatNumber(target, digits);
    }
  };
  animationFrameHandles.set(node, requestAnimationFrame(tick));
}