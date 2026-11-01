export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Swaps views as one morph where the browser supports it; elsewhere the change is instant. */
export function withTransition(update: () => void): Promise<void> {
  if (prefersReducedMotion || !document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  return document.startViewTransition(update).updateCallbackDone;
}
