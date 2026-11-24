/* Preventivatore Bacciardi Partners – portale (fase 1, "in bianco").
 * JS vanilla, zero build. Macchina a viste: login → otp → home (stepper con passi segnaposto).
 * Tutte le chiamate passano da api() → POST /api/gas → Apps Script. Nessun calcolo lato client.
 */
(function () {
  'use strict';

  var WEB_VERSION = '0.1.1';
  var TOKEN_KEY = 'prv_token';        // sessionStorage: la sessione muore con la scheda
  var DRAFT_KEY = 'prv_draft_v1';     // localStorage: bozza del preventivo in corso

  // Passi del flusso concordato (SPEC v0.3 §1). Il login è il passo 0, fuori dallo stepper.
  var STEPS = [
    { id: 'pillar', label: 'Pillar' },
    { id: 'cliente', label: 'Cliente' },
    { id: 'ambito', label: 'Ambito' },
    { id: 'servizi', label: 'Servizi' },
    { id: 'note', label: 'Note' },
    { id: 'studio', label: 'Dati Studio' },
    { id: 'verifica', label: 'Verifica ed esporta' }
  ];

  var ERR = {
    BAD_REQUEST: 'Richiesta non valida.',
    FORBIDDEN: 'Operazione non consentita.',
    UNKNOWN_ACTION: 'Funzione non disponibile.',
    SESSION_EXPIRED: 'Sessione scaduta: accedi di nuovo.',
    EMAIL_INVALID: 'Indirizzo e-mail non valido.',
    DOMAIN_NOT_ALLOWED: 'Usa l\'indirizzo e-mail dello Studio.',
    RATE_LIMITED: 'Troppe richieste di codice. Riprova tra 15 minuti.',
    OTP_INVALID: 'Codice non corretto.',
    OTP_EXPIRED: 'Codice scaduto: richiedine uno nuovo.',
    OTP_LOCKED: 'Troppi tentativi: richiedi un nuovo codice.',
    CONFIG_ERROR: 'Configurazione del server incompleta. Contatta l\'amministratore.',
    UPSTREAM_UNREACHABLE: 'Server non raggiungibile. Riprova tra poco.',
    UPSTREAM_ERROR: 'Risposta del server non valida.',
    SERVER_ERROR: 'Errore interno. Riprova; se persiste contatta l\'amministratore.',
    NETWORK: 'Connessione assente o interrotta.'
  };

  var state = { view: 'login', email: '', user: null, server: null, step: 0 };
  var app = document.getElementById('app');

  // ------------------------------------------------------------------ util
  function errText(code) { return ERR[code] || ('Errore: ' + code); }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function token() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (e) { return {}; } }
  function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {} }

  function api(action, payload) {
    return fetch('/api/gas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {}, token: token() })
    }).then(function (r) { return r.json(); }, function () { return { ok: false, error: 'NETWORK' }; })
      .then(function (res) {
        if (!res || typeof res.ok !== 'boolean') return { ok: false, error: 'UPSTREAM_ERROR' };
        if (!res.ok && res.error === 'SESSION_EXPIRED') { setToken(null); state.user = null; go('login'); }
        return res;
      }, function () { return { ok: false, error: 'UPSTREAM_ERROR' }; });
  }

  /** Esegue fn bloccando il bottone (niente doppi invii) e mostrando l'errore nel box. */
  function busy(btn, msgBox, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    msgBox.textContent = '';
    fn().then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
  }

  function go(view) { state.view = view; render(); }

  // ------------------------------------------------------------------ viste
  function viewLogin() {
    var msg = el('p', { class: 'msg', role: 'alert' });
    var input = el('input', { type: 'email', id: 'email', autocomplete: 'username', required: 'required',
      placeholder: 'nome.cognome@…', value: state.email });
    var btn = el('button', { type: 'submit', class: 'primary', text: 'Invia codice' });
    var form = el('form', { class: 'card narrow', novalidate: 'novalidate', on: { submit: function (e) {
      e.preventDefault();
      state.email = input.value.trim();
      busy(btn, msg, function () {
        return api('auth.requestOtp', { email: state.email }).then(function (r) {
          if (r.ok) go('otp'); else msg.textContent = errText(r.error);
        });
      });
    } } }, [
      el('h1', { text: 'Accesso' }),
      el('p', { class: 'hint', text: 'Inserisci la tua e-mail dello Studio: riceverai un codice di accesso.' }),
      el('label', { for: 'email', text: 'E-mail' }), input, btn, msg
    ]);
    return form;
  }

  function viewOtp() {
    var msg = el('p', { class: 'msg', role: 'alert' });
    var input = el('input', { type: 'text', id: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code',
      maxlength: '6', pattern: '[0-9]{6}', required: 'required', placeholder: '000000' });
    var btn = el('button', { type: 'submit', class: 'primary', text: 'Accedi' });
    return el('form', { class: 'card narrow', novalidate: 'novalidate', on: { submit: function (e) {
      e.preventDefault();
      busy(btn, msg, function () {
        return api('auth.verifyOtp', { email: state.email, code: input.value.trim() }).then(function (r) {
          if (!r.ok) { msg.textContent = errText(r.error); return; }
          setToken(r.data.token);
          state.user = r.data.user;
          return bootstrap();
        });
      });
    } } }, [
      el('h1', { text: 'Codice di accesso' }),
      el('p', { class: 'hint', text: 'Se l\'indirizzo ' + state.email + ' è abilitato, ti abbiamo inviato un codice di 6 cifre.' }),
      el('label', { for: 'otp', text: 'Codice' }), input, btn, msg,
      el('button', { type: 'button', class: 'link', text: 'Usa un\'altra e-mail', on: { click: function () { go('login'); } } })
    ]);
  }

  function viewHome() {
    var draft = loadDraft();
    state.step = Math.min(Math.max(Number(draft.step) || 0, 0), STEPS.length - 1);
    var s = STEPS[state.step];
    var nav = el('ol', { class: 'stepper' }, STEPS.map(function (st, i) {
      return el('li', { class: i === state.step ? 'current' : (i < state.step ? 'done' : '') }, [
        el('button', { type: 'button', 'aria-current': i === state.step ? 'step' : null, text: (i + 1) + '. ' + st.label,
          on: { click: function () { setStep(i); } } })
      ]);
    }));
    var prev = el('button', { type: 'button', text: '← Indietro', disabled: state.step === 0 ? 'disabled' : null,
      on: { click: function () { setStep(state.step - 1); } } });
    var next = el('button', { type: 'button', class: 'primary', text: 'Avanti →',
      disabled: state.step === STEPS.length - 1 ? 'disabled' : null, on: { click: function () { setStep(state.step + 1); } } });
    return el('section', { class: 'wizard' }, [
      nav,
      el('div', { class: 'card step', 'data-step': s.id }, [
        el('h1', { text: s.label }),
        el('p', { class: 'placeholder', text: 'Passo in costruzione.' })
      ]),
      el('div', { class: 'actions' }, [prev, next])
    ]);
  }

  function setStep(i) {
    var d = loadDraft();
    d.step = i;
    saveDraft(d);
    render();
  }

  function render() {
    var box = document.getElementById('userBox');
    box.hidden = !state.user;
    document.getElementById('userName').textContent = state.user ? (state.user.nome + ' ' + state.user.cognome).trim() : '';
    app.replaceChildren(state.view === 'otp' ? viewOtp() : state.view === 'home' && state.user ? viewHome() : viewLogin());
    var f = app.querySelector('input');
    if (f) f.focus();
  }

  function bootstrap() {
    return api('app.bootstrap').then(function (r) {
      if (!r.ok) return;
      state.user = r.data.user;
      state.server = r.data;
      document.getElementById('versionInfo').textContent = 'web ' + WEB_VERSION + ' · server ' + r.data.version +
        (r.data.versioneCatalogo ? ' · catalogo ' + r.data.versioneCatalogo : '');
      go('home');
    });
  }

  document.getElementById('btnLogout').addEventListener('click', function () {
    api('auth.logout').then(function () { setToken(null); state.user = null; go('login'); });
  });
  document.getElementById('vWeb').textContent = WEB_VERSION;

  if (token()) bootstrap().then(function () { if (!state.user) render(); }); else render();
})();
