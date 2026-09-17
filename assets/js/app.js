(() => {
  'use strict';

  const yearNode = document.querySelector('[data-current-year]');
  if (yearNode) yearNode.textContent = new Date().getFullYear();

  document.querySelectorAll('[data-step2-preview]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-name') || 'この機能';
      const toast = document.querySelector('#step-toast');
      if (!toast) return;

      toast.textContent = `${name} はSTEP 2でクリック操作を有効にします。`;
      toast.hidden = false;
      window.clearTimeout(window.__stepToastTimer);
      window.__stepToastTimer = window.setTimeout(() => {
        toast.hidden = true;
      }, 2600);
    });
  });
})();
