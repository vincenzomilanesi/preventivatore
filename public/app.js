/* Preventivatore Bacciardi Partners – portale (fase 1, "in bianco").
 * JS vanilla, zero build. Macchina a viste: login → otp → home (stepper con passi segnaposto).
 * Tutte le chiamate passano da api() → POST /api/gas → Apps Script. Nessun calcolo lato client.
 */
(function () {
  'use strict';

  var WEB_VERSION = '0.5.0';
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
    NETWORK: 'Connessione assente o interrotta.',
    QUERY_INVALID: 'Scrivi almeno 2 lettere o cifre (massimo 80 caratteri).',
    NOT_FOUND: 'Cliente non trovato: potrebbe essere stato modificato. Cercalo di nuovo.'
  };

  var SEARCH_DELAY_MS = 350;

  var state = { view: 'login', email: '', user: null, server: null, step: 0,
    cliente: { q: '', seq: 0, timer: null, dettaglio: null, nuovo: null } };
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
      el('div', { class: 'card step', 'data-step': s.id }, [el('h1', { text: s.label })].concat(
        STEP_VIEWS[s.id] ? STEP_VIEWS[s.id](draft) : [el('p', { class: 'placeholder', text: 'Passo in costruzione.' })])),
      el('div', { class: 'actions' }, [prev, next])
    ]);
  }

  // ------------------------------------------------------------------ passo Cliente
  // Nella bozza (localStorage) restano solo gli ID scelti, mai i dati del cliente.
  function stepCliente(draft) {
    if (draft.cliente && draft.cliente.id) return clienteScelto(draft);
    return state.cliente.nuovo ? clienteNuovo() : clienteRicerca();
  }

  /** Seleziona il cliente per il preventivo (nella bozza solo gli ID). */
  function selezionaCliente(id, referenteId) {
    var d = loadDraft();
    d.cliente = { id: id };
    d.referente = referenteId || '';
    saveDraft(d);
    state.cliente.dettaglio = null;
    state.cliente.nuovo = null;
    render();
  }

  /** Campo di modulo: etichetta + input + messaggio d'errore (id err-<nome>). */
  function campo(name, label, attrs, hint) {
    var a = { id: 'f-' + name.replace('.', '-'), name: name, autocomplete: 'off' };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    var input = el('input', a);
    return el('div', { class: 'field' + (attrs && attrs['data-wide'] ? ' wide' : '') }, [
      el('label', { for: a.id, text: label }), input,
      hint ? el('span', { class: 'hint small', text: hint }) : null,
      el('span', { class: 'err', id: 'err-' + name.replace('.', '-') })
    ].filter(Boolean));
  }

  /** Elenco di clienti esistenti con il pulsante "Usa questo". */
  function elencoClienti(list) {
    return el('ul', { class: 'results' }, list.map(function (c) {
      var meta = [c.citta, c.doc ? 'P.IVA/CF ' + c.doc : '', c.motivo || ''].filter(Boolean).join(' · ');
      return el('li', {}, [el('div', { class: 'result static' }, [
        el('span', { class: 'r-nome', text: c.nome || '(senza nome)' }), el('span', { class: 'r-meta', text: meta }),
        el('button', { type: 'button', class: 'small', text: 'Usa questo', on: { click: function () { selezionaCliente(c.id); } } })
      ])]);
    }));
  }

  function clienteNuovo() {
    var pre = state.cliente.nuovo;
    var form = el('form', { class: 'nuovo', id: 'formNuovo', novalidate: 'novalidate' });
    var esito = el('div', { id: 'nuovoEsito', role: 'alert' });
    var tipoAz = el('input', { type: 'radio', name: 'tipo', id: 'tipo-azienda', value: 'azienda' });
    var tipoPf = el('input', { type: 'radio', name: 'tipo', id: 'tipo-persona', value: 'persona' });
    (pre.tipo === 'persona' ? tipoPf : tipoAz).checked = true;
    var boxAz = el('div', { class: 'grid' }, [campo('ragioneSociale', 'Ragione sociale *', { 'data-wide': '1', maxlength: '200', value: pre.ragioneSociale || '' })]);
    var boxPf = el('div', { class: 'grid' }, [
      campo('nome', 'Nome *', { maxlength: '80', value: pre.nome || '' }), campo('cognome', 'Cognome *', { maxlength: '80', value: pre.cognome || '' })]);
    var boxRef = el('fieldset', { class: 'ref' }, [
      el('legend', { text: 'Alla cortese attenzione di (facoltativo)' }),
      el('div', { class: 'grid' }, [campo('referente.nome', 'Nome', { maxlength: '80' }), campo('referente.cognome', 'Cognome', { maxlength: '80' }),
        campo('referente.email', 'E-mail', { type: 'email', maxlength: '254' }), campo('referente.telefono', 'Telefono', { type: 'tel', maxlength: '40' })])
    ]);
    function syncTipo() { var az = tipoAz.checked; boxAz.hidden = !az; boxRef.hidden = !az; boxPf.hidden = az; }
    tipoAz.addEventListener('change', syncTipo);
    tipoPf.addEventListener('change', syncTipo);
    var btn = el('button', { type: 'submit', class: 'primary', text: 'Salva cliente' });
    var annulla = el('button', { type: 'button', text: 'Annulla', on: { click: function () { state.cliente.nuovo = null; render(); } } });

    function payload(conferma) {
      var v = function (n) { var i = form.querySelector('[name="' + n + '"]'); return i ? i.value : ''; };
      var p = { tipo: tipoAz.checked ? 'azienda' : 'persona', ragioneSociale: v('ragioneSociale'), nome: v('nome'), cognome: v('cognome'),
        piva: v('piva'), cf: v('cf'), email: v('email'), telefono: v('telefono'), indirizzo: v('indirizzo'), cap: v('cap'),
        citta: v('citta'), provincia: v('provincia'), paese: v('paese'), conferma: !!conferma };
      if (tipoAz.checked) p.referente = { nome: v('referente.nome'), cognome: v('referente.cognome'), email: v('referente.email'), telefono: v('referente.telefono') };
      return p;
    }

    function invia(conferma) {
      form.querySelectorAll('.err').forEach(function (x) { x.textContent = ''; });
      esito.replaceChildren();
      busy(btn, esito, function () {
        return api('clienti.create', payload(conferma)).then(function (r) {
          setTimeout(function () { if (esito.firstChild && esito.scrollIntoView) esito.scrollIntoView({ block: 'nearest' }); }, 0);
          if (!r.ok) { esito.replaceChildren(el('p', { class: 'msg', text: errText(r.error) })); return; }
          var d = r.data;
          if (d.esito === 'creato') { selezionaCliente(d.id, d.referenteId); return; }
          if (d.esito === 'errori') {
            Object.keys(d.errori).forEach(function (k) {
              var sp = document.getElementById('err-' + k.replace('.', '-'));
              if (sp) sp.textContent = d.errori[k];
            });
            if (d.errori._generale) esito.replaceChildren(el('p', { class: 'msg', text: d.errori._generale }));
            else esito.replaceChildren(el('p', { class: 'msg', text: 'Correggi i campi segnalati.' }));
            var first = form.querySelector('.err:not(:empty)');
            if (first && first.parentNode.querySelector('input')) first.parentNode.querySelector('input').focus();
            return;
          }
          if (d.esito === 'duplicato') {
            esito.replaceChildren(el('div', { class: 'box warn' }, [
              el('p', { text: 'Questo cliente esiste già (stessi dati identificativi). Usa quello esistente:' }), elencoClienti(d.clienti)]));
            return;
          }
          if (d.esito === 'simile') {
            esito.replaceChildren(el('div', { class: 'box warn' }, [
              el('p', { text: 'Ci sono clienti con lo stesso nome nella stessa città. È uno di questi?' }), elencoClienti(d.clienti),
              el('button', { type: 'button', id: 'btnCreaComunque', text: 'No, è un cliente diverso: crea comunque',
                on: { click: function () { invia(true); } } })]));
          }
        });
      });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); invia(false); });

    form.append(
      el('fieldset', { class: 'tipo' }, [el('legend', { text: 'Tipo di cliente' }),
        el('label', { class: 'radio', for: 'tipo-azienda' }, [tipoAz, ' Azienda']),
        el('label', { class: 'radio', for: 'tipo-persona' }, [tipoPf, ' Persona fisica'])]),
      boxAz, boxPf,
      el('div', { class: 'grid' }, [
        campo('piva', 'P.IVA', { maxlength: '30', value: pre.piva || '' }), campo('cf', 'Codice fiscale', { maxlength: '20' }),
        campo('email', 'E-mail', { type: 'email', maxlength: '254', value: pre.email || '' }), campo('telefono', 'Telefono', { type: 'tel', maxlength: '40' }),
        campo('indirizzo', 'Indirizzo', { 'data-wide': '1', maxlength: '150' }), campo('cap', 'CAP', { maxlength: '12', inputmode: 'numeric' }),
        campo('citta', 'Città *', { maxlength: '80' }), campo('provincia', 'Provincia', { maxlength: '60' }), campo('paese', 'Paese', { maxlength: '60', value: 'Italia' })]),
      el('p', { class: 'hint', text: '* obbligatori. Serve anche almeno uno tra e-mail, P.IVA e codice fiscale.' }),
      boxRef, esito, el('div', { class: 'inline-actions' }, [btn, annulla]));
    syncTipo();
    return [el('h2', { text: 'Nuovo cliente' }), form];
  }

  /** Precompila il modulo con quanto cercato (e-mail, P.IVA o nome). */
  function precompila(q) {
    q = String(q || '').trim();
    if (q.indexOf('@') >= 0) return { email: q };
    if (/^(IT)?\s*\d{11}$/i.test(q)) return { piva: q };
    return { ragioneSociale: q };
  }

  function clienteRicerca() {
    var cs = state.cliente;
    var status = el('p', { class: 'status', id: 'clienteStatus', role: 'status' });
    var list = el('ul', { class: 'results', id: 'clienteRisultati' });
    var input = el('input', { type: 'search', id: 'clienteQ', autocomplete: 'off', spellcheck: 'false', maxlength: '80',
      placeholder: 'es. Rossi, Alfa Srl, 01234567897, nome@azienda.it', value: cs.q,
      on: { input: function () { cs.q = input.value; schedule(); } } });

    function schedule() {
      clearTimeout(cs.timer);
      var q = cs.q.trim();
      if (q.replace(/[^0-9a-zA-ZÀ-ÿ]/g, '').length < 2) { list.replaceChildren(); status.textContent = ''; return; }
      status.textContent = 'Ricerca in corso…';
      cs.timer = setTimeout(function () { run(q); }, SEARCH_DELAY_MS);
    }

    function run(q) {
      var seq = ++cs.seq;
      api('clienti.search', { q: q }).then(function (r) {
        if (seq !== cs.seq) return;   // risposta superata da una ricerca più recente
        if (!r.ok) { list.replaceChildren(); status.textContent = errText(r.error); return; }
        var d = r.data;
        status.textContent = d.totale === 0 ? 'Nessun cliente trovato.' : d.totale > d.risultati.length
          ? 'Mostrati i primi ' + d.risultati.length + ' di ' + d.totale + ': aggiungi un termine per restringere.'
          : d.totale + (d.totale === 1 ? ' cliente trovato.' : ' clienti trovati.');
        list.replaceChildren.apply(list, d.risultati.map(function (c) {
          var meta = [c.citta, c.doc ? (c.tipo === 'persona' && c.doc.length === 16 ? 'CF ' : 'P.IVA ') + c.doc : '',
            c.tipo === 'persona' ? 'persona fisica' : '', c.cliente ? 'cliente con pratiche' : '',
            c.via ? 'referente: ' + c.via : ''].filter(Boolean).join(' · ');
          return el('li', {}, [el('button', { type: 'button', class: 'result', on: { click: function () { scegli(c.id); } } }, [
            el('span', { class: 'r-nome', text: c.nome || '(senza nome)' }), el('span', { class: 'r-meta', text: meta })
          ])]);
        }));
      });
    }

    function scegli(id) { selezionaCliente(id); }

    if (cs.q.trim()) setTimeout(schedule, 0);
    return [
      el('label', { for: 'clienteQ', text: 'Cerca cliente' }), input,
      el('p', { class: 'hint', text: 'Nome, cognome, ragione sociale, P.IVA, codice fiscale o e-mail (anche di un referente).' }),
      status, list,
      el('div', { class: 'inline-actions' }, [el('button', { type: 'button', id: 'btnNuovoCliente', text: '+ Nuovo cliente',
        on: { click: function () { state.cliente.nuovo = precompila(cs.q); render(); } } })]),
      el('p', { class: 'hint', text: 'Cliente non presente? Inseriscilo come nuovo: verrà controllato che non esista già.' })
    ];
  }

  function clienteScelto(draft) {
    var box = el('div', { class: 'cliente-scelto', id: 'clienteScelto' }, [el('p', { class: 'hint', text: 'Caricamento…' })]);
    var cambia = el('button', { type: 'button', id: 'btnCambiaCliente', text: 'Cambia cliente', on: { click: function () {
      var d = loadDraft();
      delete d.cliente;
      delete d.referente;
      saveDraft(d);
      state.cliente.dettaglio = null;
      render();
    } } });
    var cached = state.cliente.dettaglio;
    if (cached && cached.id === draft.cliente.id) fill(cached);
    else api('clienti.get', { id: draft.cliente.id }).then(function (r) {
      if (!r.ok) { box.replaceChildren(el('p', { class: 'msg', role: 'alert', text: errText(r.error) })); return; }
      state.cliente.dettaglio = r.data;
      fill(r.data);
    });

    function fill(c) {
      var rows = [
        ['Tipo', c.tipo === 'persona' ? 'Persona fisica' : 'Azienda'],
        ['Stato', c.cliente_elibra === 'Sì' ? 'Cliente con pratiche (eLibra)' : c.cliente_elibra === 'No'
          ? 'In anagrafica eLibra, senza pratiche' : c.origine === 'configuratore'
          ? 'Nuovo, inserito dal portale (non ancora in eLibra né in HubSpot)' : 'Contatto HubSpot (non in eLibra)'],
        ['P.IVA', c.piva], ['Codice fiscale', c.cf],
        ['Indirizzo', [c.indirizzo, [c.cap, c.citta].filter(Boolean).join(' '), c.provincia, c.paese].filter(Boolean).join(', ')],
        ['E-mail', c.email], ['Telefono', c.telefono]
      ].filter(function (x) { return x[1]; });
      var dl = el('dl', { class: 'dati' }, [].concat.apply([], rows.map(function (x) {
        return [el('dt', { text: x[0] }), el('dd', { text: x[1] })];
      })));
      var parts = [el('h2', { text: c.denominazione || '(senza nome)' }), dl];
      if (c.referenti.length) {
        var sel = el('select', { id: 'clienteReferente', on: { change: function () {
          var d = loadDraft(); d.referente = sel.value; saveDraft(d);
        } } }, [el('option', { value: '', text: '— nessun referente —' })].concat(c.referenti.map(function (r) {
          return el('option', { value: r.id, text: [r.cognome, r.nome].filter(Boolean).join(' ') + (r.email ? ' · ' + r.email : '') });
        })));
        var cur = loadDraft().referente || '';
        if (c.referenti.some(function (r) { return r.id === cur; })) sel.value = cur;
        parts.push(el('label', { for: 'clienteReferente', text: 'Alla cortese attenzione di' }), sel);
      } else {
        parts.push(el('p', { class: 'hint', text: 'Nessun referente registrato per questo cliente.' }));
      }
      parts.push(nuovoReferente(c));
      box.replaceChildren.apply(box, parts);
    }

    function nuovoReferente(c) {
      var wrap = el('div', { class: 'nuovo-ref' });
      var apri = el('button', { type: 'button', class: 'link', id: 'btnAggiungiReferente', text: '+ Aggiungi referente', on: { click: function () {
        var msg = el('div', { role: 'alert' });
        var f = el('form', { class: 'nuovo', novalidate: 'novalidate' }, [
          el('div', { class: 'grid' }, [campo('rnome', 'Nome *', { maxlength: '80' }), campo('rcognome', 'Cognome *', { maxlength: '80' }),
            campo('remail', 'E-mail', { type: 'email', maxlength: '254' }), campo('rtelefono', 'Telefono', { type: 'tel', maxlength: '40' })]),
          msg]);
        var salva = el('button', { type: 'submit', class: 'primary', text: 'Salva referente' });
        var annulla = el('button', { type: 'button', text: 'Annulla', on: { click: function () { wrap.replaceChildren(apri); } } });
        f.append(el('div', { class: 'inline-actions' }, [salva, annulla]));
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var v = function (n) { return f.querySelector('[name="' + n + '"]').value; };
          f.querySelectorAll('.err').forEach(function (x) { x.textContent = ''; });
          busy(salva, msg, function () {
            return api('referenti.create', { idCliente: c.id, nome: v('rnome'), cognome: v('rcognome'), email: v('remail'), telefono: v('rtelefono') })
              .then(function (r) {
                if (!r.ok) { msg.replaceChildren(el('p', { class: 'msg', text: errText(r.error) })); return; }
                if (r.data.esito === 'errori') {
                  var map = { nome: 'rnome', cognome: 'rcognome', email: 'remail', telefono: 'rtelefono' };
                  Object.keys(r.data.errori).forEach(function (k) { var sp = document.getElementById('err-' + map[k]); if (sp) sp.textContent = r.data.errori[k]; });
                  return;
                }
                var d = loadDraft();
                d.referente = r.data.id;
                saveDraft(d);
                state.cliente.dettaglio = null;
                if (r.data.esito === 'duplicato') state.cliente.avviso = 'Il referente era già presente: è stato selezionato.';
                render();
              });
          });
        });
        wrap.replaceChildren(f);
        f.querySelector('input').focus();
      } } });
      wrap.append(apri);
      if (state.cliente.avviso) { wrap.prepend(el('p', { class: 'hint ok', role: 'status', text: state.cliente.avviso })); state.cliente.avviso = ''; }
      return wrap;
    }
    return [box, el('div', { class: 'inline-actions' }, [cambia])];
  }

  var STEP_VIEWS = { cliente: stepCliente };

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
    api('auth.logout').then(function () { setToken(null); state.user = null; state.cliente.dettaglio = null; state.cliente.nuovo = null; go('login'); });
  });
  document.getElementById('vWeb').textContent = WEB_VERSION;

  if (token()) bootstrap().then(function () { if (!state.user) render(); }); else render();
})();
