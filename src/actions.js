// Event delegation. Markup carries data-action (click) or data-change
// (change) instead of inline handlers, so no user text is ever evaluated as
// script and the page works under a strict Content-Security-Policy.

const clickHandlers = new Map();
const changeHandlers = new Map();

export function onAction(name, handler) {
  clickHandlers.set(name, handler);
}

export function onChange(name, handler) {
  changeHandlers.set(name, handler);
}

export function initActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const handler = clickHandlers.get(el.dataset.action);
    if (handler) handler(el.dataset, el, e);
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const handler = changeHandlers.get(el.dataset.change);
    if (handler) handler(el.dataset, el, e);
  });
}
