(function () {
  'use strict';

  async function boot() {
    try {
      if (window.initTheme) window.initTheme();
      if (window.updateTopbarClock) window.updateTopbarClock();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }

      if (!window.API || typeof window.API.get !== 'function') {
        throw new Error('API não foi carregada.');
      }

      const session = await window.API.get('/auth/me');
      if (session && session.id && typeof window.startApp === 'function') {
        localStorage.setItem('g3d_user', JSON.stringify(session));
        window.startApp(session);
        return;
      }

      localStorage.removeItem('g3d_user');
      window.showLogin?.();
    } catch (error) {
      localStorage.removeItem('g3d_user');
      window.showLogin?.();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
