/* Original brand artwork, brief home greeting, no stored visit flag. */
(() => {
  'use strict';
  const script = document.currentScript;
  const brand = script?.dataset.brand;
  const logo = script?.dataset.logo;
  const selector = script?.dataset.logoSelector;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const atHome = () => ['/', '/index.html'].includes(location.pathname);
  if (!brand || (!logo && !selector) || !atHome()) return;
  let active;
  const allowed = () => !motion.matches && document.documentElement.dataset.motion !== 'off' && !document.hidden;
  function finish() {
    if (!active) return;
    clearTimeout(active.timeout);
    active.overlay?.remove();
    active = null;
    document.removeEventListener('pointerdown', finish, true);
    document.removeEventListener('keydown', finish, true);
  }
  async function play() {
    finish();
    if (!allowed()) return;
    const state = {overlay: null, timeout: setTimeout(finish, 4500)};
    active = state;
    document.addEventListener('pointerdown', finish, true);
    document.addEventListener('keydown', finish, true);
    const overlay = document.createElement('div');
    overlay.className = 'eunisys-greeting greeting-' + brand;
    overlay.setAttribute('aria-hidden', 'true');
    let mark;
    if (selector) {
      const original = document.querySelector(selector);
      if (!original) { finish(); return; }
      mark = original.cloneNode(true);
      mark.removeAttribute('id');
      mark.removeAttribute('role');
      mark.removeAttribute('aria-label');
      mark.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      const embedded = mark.querySelector('image')?.getAttribute('href');
      if (embedded) {
        const probe = new Image();
        probe.src = embedded;
        try { await probe.decode(); } catch { if (active === state) finish(); return; }
      }
    } else {
      mark = new Image();
      mark.alt = '';
      mark.decoding = 'async';
      mark.src = logo;
      try { await mark.decode(); } catch { if (active === state) finish(); return; }
    }
    if (active !== state || !allowed()) { if (active === state) finish(); return; }
    mark.classList.add('eunisys-greeting-mark');
    overlay.append(mark);
    state.overlay = overlay;
    overlay.addEventListener('animationend', event => { if (event.target === overlay && active === state) finish(); });
    document.body.append(overlay);
  }
  function start() {
    play();
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const url = new URL(anchor.href, location.href);
      if (atHome() && url.origin === location.origin && ['/', '/index.html'].includes(url.pathname) && !url.search && (!url.hash || url.hash === '#top')) {
        event.preventDefault();
        play();
        // Replaying the greeting never reloads a form or resets the current app.
        scrollTo(0, 0);
      }
    });
    new MutationObserver(() => { if (!allowed()) finish(); }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-motion']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
  motion.addEventListener('change', event => { if (event.matches) finish(); });
  window.addEventListener('pagehide', finish);
  window.addEventListener('pageshow', event => { if (event.persisted) play(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
})();
