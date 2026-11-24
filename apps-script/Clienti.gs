/**
 * Passo "Cliente" (SPEC §1 passo 3): ricerca lato server e dettaglio del cliente scelto.
 * L'indice di ricerca (compatto, solo campi da mostrare) sta in CacheService a blocchi per 6 ore e si invalida
 * a ogni import o inserimento. La ricerca non viene scritta nel Log (può contenere dati personali).
 */
var CLIENTI_IDX_KEY = 'cidx_v1';
var CLIENTI_IDX_CHUNK = 40000;     // caratteri per blocco (limite CacheService: 100 KB per valore)
var CLIENTI_IDX_TTL = 21600;       // 6 ore (massimo CacheService)
var CLIENTI_SEARCH_LIMIT = 20;

function actClientiSearch_(p) {
  var q = String(p.q || '');
  if (!isSearchQueryOk_(q)) fail_('QUERY_INVALID');
  return searchIndex_(clientiIndex_(), q, CLIENTI_SEARCH_LIMIT);
}

/** Dettaglio del cliente + referenti (per la scelta "alla c.a. di"). */
function actClientiGet_(p) {
  var id = String(p.id || '');
  if (!/^CLI-\d{6}$/.test(id)) fail_('NOT_FOUND');
  var c = null;
  var rows = readTable_('Clienti');
  for (var i = 0; i < rows.length && !c; i++) if (rows[i].ID_CLIENTE === id) c = rows[i];
  if (!c) fail_('NOT_FOUND');
  var refs = readTable_('Referenti').filter(function (r) { return r.ID_CLIENTE === id; }).map(function (r) {
    return { id: r.ID_REFERENTE, nome: r.NOME, cognome: r.COGNOME, email: r.EMAIL, telefono: r.TELEFONO };
  }).sort(function (a, b) { return (a.cognome + a.nome).localeCompare(b.cognome + b.nome, 'it'); });
  var out = { id: c.ID_CLIENTE, denominazione: clienteLabel_(c), referenti: refs };
  ['TIPO', 'RAGIONE_SOCIALE', 'NOME', 'COGNOME', 'PIVA', 'CF', 'EMAIL', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA',
    'PROVINCIA', 'PAESE', 'ORIGINE', 'STATO_HUBSPOT'].forEach(function (k) { out[k.toLowerCase()] = c[k]; });
  return out;
}

/** Indice di ricerca dalla cache; se manca o è incompleto lo ricostruisce dai fogli. */
function clientiIndex_() {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(CLIENTI_IDX_KEY + '_n') || 0);
  if (n > 0) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(CLIENTI_IDX_KEY + '_' + i);
    var got = cache.getAll(keys);
    if (keys.every(function (k) { return got[k] !== undefined && got[k] !== null; })) {
      try { return JSON.parse(keys.map(function (k) { return got[k]; }).join('')); } catch (e) { /* ricostruisce */ }
    }
  }
  return rebuildClientiIndex_();
}

function rebuildClientiIndex_() {
  var idx = buildClientiIndex_(readTable_('Clienti'), readTable_('Referenti'));
  var s = JSON.stringify(idx);
  var put = {}, n = 0;
  for (var i = 0; i < s.length; i += CLIENTI_IDX_CHUNK) put[CLIENTI_IDX_KEY + '_' + n++] = s.slice(i, i + CLIENTI_IDX_CHUNK);
  try {
    var cache = CacheService.getScriptCache();
    cache.putAll(put, CLIENTI_IDX_TTL);
    cache.put(CLIENTI_IDX_KEY + '_n', String(n), CLIENTI_IDX_TTL);   // per ultimo: l'indice è completo
  } catch (e) { /* cache piena o non disponibile: si lavora senza */ }
  return idx;
}

/** Da chiamare dopo ogni modifica a Clienti o Referenti. */
function invalidateClientiIndex_() {
  CacheService.getScriptCache().remove(CLIENTI_IDX_KEY + '_n');
}
