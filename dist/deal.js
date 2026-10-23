(() => {
 const button = document.querySelector('[data-copy-sample]');
 if (!button) return;
 button.addEventListener('click', async () => {
  const code = document.querySelector('#deal-code');
  try {
   await navigator.clipboard.writeText(code.textContent);
   button.textContent = 'Copied';
   setTimeout(() => { button.textContent = 'Copy code'; }, 2200);
  } catch {
   const range = document.createRange(); range.selectNodeContents(code);
   const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
   button.textContent = 'Code selected';
  }
 });
})();
