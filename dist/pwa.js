(() => {
  let installPrompt;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const updateInstalledState = () => {
    const installed = standalone();
    for (const link of document.querySelectorAll('.install-link')) link.hidden = installed;
    const status = document.querySelector('#install-status');
    if (installed && status) status.textContent = 'You’re already using the app.';
    if (installed) for (const button of document.querySelectorAll('[data-install-app]')) button.hidden = true;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    if (standalone()) return;
    for (const button of document.querySelectorAll('[data-install-app]')) button.hidden = false;
    const status = document.querySelector('#install-status');
    if (status) status.textContent = 'Ready to install. Choose install.fluq_ below.';
  });
  const promptInstall = async () => {
    if (!installPrompt) return;
    const pending = installPrompt; installPrompt = undefined;
    for (const button of document.querySelectorAll('[data-install-app]')) button.hidden = true;
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      const status = document.querySelector('#install-status');
      if (status) status.textContent = choice.outcome === 'accepted' ? 'Installation requested. Chrome will finish setting up the app.' : 'No problem. You can install later from Chrome’s menu.';
    } catch {
      const status = document.querySelector('#install-status');
      if (status) status.textContent = 'Use Chrome’s menu to install this page as an app.';
    }
  };
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-install-app], .install-link');
    if (!target || !installPrompt) return;
    event.preventDefault(); void promptInstall();
  });
  window.addEventListener('appinstalled', () => { installPrompt = undefined; updateInstalledState(); for (const link of document.querySelectorAll('.install-link')) link.hidden = true; for (const button of document.querySelectorAll('[data-install-app]')) button.hidden = true; });
  updateInstalledState();
  if ('serviceWorker' in navigator) {
    const register = () => { navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}); };
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
  }
})();
