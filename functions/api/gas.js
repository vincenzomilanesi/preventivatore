/**
 * Cloudflare Pages Function: POST /api/gas  →  Apps Script web app.
 *
 * Variabili d'ambiente (Cloudflare Pages > Settings > Environment variables, tipo "Secret"):
 *   GAS_URL       URL /exec del deployment Apps Script
 *   PROXY_SECRET  stesso valore della proprietà script PROXY_SECRET
 *
 * Il browser non conosce né l'URL Apps Script né il segreto. Il proxy accetta solo JSON piccoli con
 * {action, payload, token} e inoltra aggiungendo proxySecret. Apps Script risponde con un redirect 302
 * verso script.googleusercontent.com: fetch lo segue (POST→GET) e restituisce il JSON finale.
 */
const MAX_BODY = 64 * 1024;
const ACTION_RE = /^[a-z][a-zA-Z0-9.]{1,40}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.GAS_URL || !env.PROXY_SECRET) return json({ ok: false, error: 'CONFIG_ERROR' }, 500);
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return json({ ok: false, error: 'BAD_REQUEST' }, 415);
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }
  if (!body || typeof body.action !== 'string' || !ACTION_RE.test(body.action)) {
    return json({ ok: false, error: 'BAD_REQUEST' }, 400);
  }
  const forward = {
    action: body.action,
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    token: typeof body.token === 'string' ? body.token : null,
    proxySecret: env.PROXY_SECRET,
  };
  let upstream;
  try {
    upstream = await fetch(env.GAS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forward),
      redirect: 'follow',
    });
  } catch {
    return json({ ok: false, error: 'UPSTREAM_UNREACHABLE' }, 502);
  }
  const out = await upstream.text();
  try {
    JSON.parse(out);
  } catch {
    return json({ ok: false, error: 'UPSTREAM_ERROR' }, 502);
  }
  return new Response(out, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
