(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function setError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function showLogin() {
    const register = $('register-form');
    const login = $('login-form');
    if (register) register.style.display = 'none';
    if (login) login.style.display = 'grid';
    setError('register-error', '');
  }

  function showRegister() {
    const login = $('login-form');
    const register = $('register-form');
    if (login) login.style.display = 'none';
    if (register) register.style.display = 'grid';
    setError('login-error', '');
    $('register-name')?.focus();
  }

  async function parseResponse(response) {
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error('O servidor retornou uma resposta inválida.');
    }
    return data;
  }

  async function requestAuth(path, payload) {
    const response = await fetch('/api/auth/' + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseResponse(response);
    if (!response.ok) {
      throw new Error(data.error || `Não foi possível concluir a operação (${response.status}).`);
    }
    if (!data?.user) {
      throw new Error('O servidor não confirmou a sessão de usuário.');
    }
    return data;
  }

  async function confirmSession(data) {
    if (window.API) window.API.csrfToken = data.csrfToken || null;

    // Confirm the browser can actually use the session cookie that the server
    // just created. This prevents a successful login from immediately falling
    // back to the login screen because the cookie was not persisted.
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    const session = await parseResponse(response);
    if (!response.ok || !session?.id) {
      throw new Error('Login aceito, mas a sessão não foi mantida pelo navegador. Verifique os cookies do site e tente novamente.');
    }

    const user = session;
    localStorage.setItem('g3d_user', JSON.stringify(user));
    return user;
  }

  async function finishLogin(data) {
    const user = await confirmSession(data);

    if (typeof window.startApp !== 'function') {
      throw new Error('A interface principal não foi carregada. Recarregue a página e tente novamente.');
    }

    window.startApp(user);
  }

  async function doLogin(event) {
    event?.preventDefault();
    const email = String($('login-email')?.value || '').trim();
    const password = String($('login-pass')?.value || '');
    const button = document.querySelector('#login-form button.btn-primary');
    setError('login-error', '');

    if (!email || !password) {
      setError('login-error', 'Informe o e-mail e a senha.');
      return;
    }

    setBusy(button, true, 'Entrando...');
    try {
      const data = await requestAuth('login', { email, password });
      await finishLogin(data);
    } catch (error) {
      // Keep the e-mail so the user does not have to type it again. Passwords
      // are deliberately cleared after any failed authentication attempt.
      const pass = $('login-pass');
      if (pass) pass.value = '';
      setError('login-error', error?.message || 'Não foi possível entrar.');
    } finally {
      setBusy(button, false);
    }
  }

  async function doRegister(event) {
    event?.preventDefault();
    const name = String($('register-name')?.value || '').trim();
    const email = String($('register-email')?.value || '').trim();
    const password = String($('register-pass')?.value || '');
    const confirmPassword = String($('register-pass-confirm')?.value || '');
    const invite = String($('register-invite')?.value || '').trim();
    const button = document.querySelector('#register-form button.btn-primary');
    setError('register-error', '');

    if (!name || !email || !password) {
      setError('register-error', 'Preencha nome, e-mail e senha.');
      return;
    }
    if (password.length < 8) {
      setError('register-error', 'A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('register-error', 'As senhas não são iguais.');
      return;
    }

    setBusy(button, true, 'Criando conta...');
    try {
      const data = await requestAuth('register', { name, email, password, invite });
      await finishLogin(data);
    } catch (error) {
      $('register-pass') && ( $('register-pass').value = '' );
      $('register-pass-confirm') && ( $('register-pass-confirm').value = '' );
      setError('register-error', error?.message || 'Não foi possível criar a conta.');
    } finally {
      setBusy(button, false);
    }
  }

  window.showLogin = showLogin;
  window.showRegister = showRegister;
  window.doLogin = doLogin;
  window.doRegister = doRegister;

  document.addEventListener('DOMContentLoaded', () => {
    const loginForm = $('login-form');
    const registerForm = $('register-form');
    const loginButton = document.querySelector('#login-form button.btn-primary');
    const registerLink = document.querySelector('#login-form .auth-link');
    const registerButton = document.querySelector('#register-form button.btn-primary');
    const backLink = document.querySelector('#register-form .auth-link');

    loginForm?.addEventListener('submit', doLogin);
    registerForm?.addEventListener('submit', doRegister);
    if (!loginForm?.matches('form')) loginButton?.addEventListener('click', doLogin);
    if (!registerForm?.matches('form')) registerButton?.addEventListener('click', doRegister);
    registerLink?.addEventListener('click', (event) => {
      event.preventDefault();
      showRegister();
    });
    backLink?.addEventListener('click', (event) => {
      event.preventDefault();
      showLogin();
    });

    $('login-pass')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') doLogin(event);
    });
    $('register-pass-confirm')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') doRegister(event);
    });
  });
})();
