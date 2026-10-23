(() => {
  let toastTimer;
  const notify = message => {
    let toast = document.querySelector('#share-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'share-toast';
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
  };
  for (const button of document.querySelectorAll('[data-share-site]')) button.hidden = false;
  document.addEventListener('click', async event => {
      const button = event.target.closest('[data-share-site]');
      if (!button || button.disabled) return;
      const path = button.dataset.shareUrl || '/s/fluq';
      if (!/^\/s\/[a-z0-9-]+$/.test(path)) return;
      const url = 'https://fluqon.qpon' + path;
      const shareData = { title: button.dataset.shareTitle || 'fluqon.qpon — Fluke on Coupon', text: button.dataset.shareTitle ? 'Sample offer — not a verified live deal.' : 'Fluke on Coupon. Australian coupons and checkout price anomalies.', url }; 
      button.disabled = true;
      try {
        if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
          try {
            await navigator.share(shareData);
            return;
          } catch (error) {
            if (error.name === 'AbortError') return;
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          button.textContent = 'copied.fluq_';
          notify('copied.fluq_. Pass it on.');
          setTimeout(() => { button.textContent = 'share.fluq_'; }, 2200);
        } catch {
          notify('Copy this link: ' + url);
        }
      } finally {
        button.disabled = false;
      }
  });
})();
