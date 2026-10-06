# ESPEC PORTABLE — hgcash desde el PANEL (credenciales + reenvío de webhooks)

> Para copiar TAL CUAL a otro repo de la misma familia (server.js + panel `adminprivado2026`).
> Origen: AUTOGIROXcompartido, WORKLOG #320 (credenciales) y #326 (reenvío), 2026-10-06.
> Todo el código de abajo es el que está en producción acá; los números de línea son los de
> este repo al momento de escribir el doc (orientativos).

## Qué implementa

1. **Credenciales de hgcash desde el panel (#320).** Card "🔐 Cuenta hgcash conectada" en
   Comandos → Banco automático (solo admin general): se pega el **token de API** (`cash_…`)
   y el **secreto del webhook** de la cuenta hgcash. Se guardan CIFRADOS (AES-256-GCM con
   clave derivada de `JWT_SECRET`) en `Config['hgcashCredentials']`; cada instancia los
   carga en memoria al arrancar y cada 60 s. **Panel > SSM**: lo del panel manda y
   `HGCASH_API_TOKEN` / `HGCASH_WEBHOOK_SECRET` de SSM quedan de respaldo (o se pueden no
   cargar). El token se prueba contra `GET /accounts` de hgcash ANTES de guardar. El
   webhook acepta la firma con el secreto del panel **o** el de SSM (cambio de cuenta sin
   perder avisos). Al cambiar el token se limpia el `accountId` cacheado (se vuelve a
   resolver con la cuenta nueva). Botón "Volver a usar AWS (SSM)" borra lo del panel.
2. **Reenvío (fan-out) de los avisos de hgcash a otras páginas (#326).** hgcash permite
   UNA sola URL de webhook por cuenta: la página que la tiene reenvía cada aviso (body
   crudo + firma original) a las otras páginas que comparten la cuenta; cada una carga
   solo las transferencias de SUS clientes (por comprobante). Destinos configurables en
   el panel (`Config['hgcashFanout'].urls`, hasta 5; sin config vale `HGCASH_FANOUT_URL`).
   Anti-círculo: un aviso que llega con `X-Forwarded-By` NO se vuelve a reenviar, y nunca
   se reenvía a la URL propia. El panel muestra el último resultado por destino.

## Requisitos previos en el repo destino

- `JWT_SECRET` en SSM/env (se usa para cifrar). Si cambia, lo guardado no se puede
  descifrar → el server cae a SSM y la card lo avisa.
- `getPublicBaseUrl()` (URL pública del sitio) — se usa para la URL propia del webhook.
- `Config` (modelo con `Config.set(key, value, updatedBy)`), `getConfig`, `setConfig`,
  `getHgcashConfig()`, `logger`, `crypto`, `axios`, `authMiddleware`, `adminMiddleware`,
  `authFetch`/`showToast`/`escapeHtml`/`fmtFechaHoraAR` en el panel.
- `express.json` con `verify` que deje `req.rawBody` (el webhook valida HMAC sobre el
  body crudo y el reenvío manda esos mismos bytes).

---

## 1) `src/services/hgcashService.js` — token con override desde el panel

Reemplazar la lectura directa de `process.env.HGCASH_API_TOKEN` por estos getters y usar
`getToken()` en TODAS las llamadas a la API de hgcash. `getAccounts(withToken)` sirve para
probar un token antes de guardarlo.

```js

// #320: el token se puede cargar desde el PANEL (Config cifrado, lo carga server.js en
// memoria al arrancar y cada 60 s). El del panel MANDA; SSM (HGCASH_API_TOKEN) queda de
// respaldo. Así un cambio de cuenta hgcash no depende de entrar a AWS.
let _tokenOverride = null;
function setTokenOverride(t) { _tokenOverride = (typeof t === 'string' && t.trim()) ? t.trim() : null; }
function getTokenSource() { return _tokenOverride ? 'panel' : (process.env.HGCASH_API_TOKEN ? 'ssm' : 'none'); }
function getToken() { return _tokenOverride || process.env.HGCASH_API_TOKEN || null; }

/** true si hay token de API configurado (el pago automático está disponible). */
function isEnabled() { return !!getToken(); }

function _headers() {
  return { Authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' };
}

// Valida un CBU/CVU o alias y devuelve el titular real (para que el agente confirme
// a quién le está pagando). Servicio pago de hgcash (costo chico por consulta).
// @returns { ok, data: { alias, cvu, cuit, nombre, tipoPersona } } | { ok:false, error }
async function lookupAlias(aliasOrCvu) {
  if (!getToken()) return { ok: false, error: 'HGCASH_API_TOKEN no configurado' };
  const value = String(aliasOrCvu || '').trim();
  if (!value) return { ok: false, error: 'alias/CVU vacío' };
  try {
    const r = await axios.post(`${BASE}/alias-lookup`, { alias: value }, { headers: _headers(), timeout: 15000 });
    return { ok: true, data: r.data || {} };
  } catch (e) {
    const detail = e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data).slice(0, 200)}` : e.message;
    logger.warn(`[hgcash-pay] alias-lookup falló (${value}): ${detail}`);
    return { ok: false, error: detail, httpStatus: e.response && e.response.status };
  }
}

// Lista las cuentas hgcash a las que el TOKEN actual tiene acceso. Es la fuente de
// verdad para resolver el accountId a debitar: si cambiás de cuenta/token, esto
// devuelve la cuenta nueva (evita el 403 "No tienes acceso a esta cuenta" por usar
// un accountId viejo cacheado). GET /accounts → { data: [{ id, currency, status, ... }] }.
// @returns { ok, data: [accounts] } | { ok:false, error, httpStatus }
// #320: `withToken` opcional → prueba un token NUEVO antes de guardarlo (no toca el vigente).
async function getAccounts(withToken) {
  const tok = (typeof withToken === 'string' && withToken.trim()) ? withToken.trim() : getToken();
  if (!tok) return { ok: false, error: 'HGCASH_API_TOKEN no configurado' };
  try {
    const r = await axios.get(`${BASE}/accounts`, { headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, timeout: 15000 });
    const data = (r.data && Array.isArray(r.data.data)) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
    return { ok: true, data };
  } catch (e) {
    const httpStatus = e.response && e.response.status;
    const detail = e.response ? `HTTP ${httpStatus} ${JSON.stringify(e.response.data).slice(0, 200)}` : e.message;
    logger.warn(`[hgcash-pay] get-accounts falló: ${detail}`);
    return { ok: false, error: detail, httpStatus };
  }
}
```

Exportar además: `setTokenOverride, getTokenSource, getToken, getAccounts`.

---

## 2) `server.js` — bloque #320 (credenciales cifradas + carga periódica + secretos del webhook)

Va cerca del webhook de hgcash. Requiere `const crypto = require('crypto')` y `hgcashPay`
(= require del servicio de arriba).

```js
// ============================================
// #320 CREDENCIALES hgcash desde el PANEL (token de API + secreto del webhook)
// ============================================
// Owner: que un cambio de cuenta hgcash (se cae una, cambia el titular) lo pueda hacer un
// admin desde el panel, sin entrar a AWS SSM. Se guardan CIFRADAS (AES-256-GCM, clave
// derivada de JWT_SECRET, que ya vive en SSM) en Config['hgcashCredentials']; un dump de la
// base no las expone. Cada instancia las carga en memoria al arrancar y cada 60 s.
// Prioridad: panel > SSM. El webhook acepta la firma con CUALQUIERA de los dos secretos
// (panel o SSM) → durante el cambio de cuenta no se pierde ningún aviso.
// ⚠️ Si JWT_SECRET cambia, lo guardado no se puede descifrar → se usa SSM (y el panel avisa).
let _hgcashPanelSecret = null;
let _hgcashCredMeta = null; // { tokenLast4, secretLast4, updatedBy, updatedAt, decryptError }
function _credKey() {
  const base = process.env.JWT_SECRET || JWT_SECRET || '';
  if (!base) return null;
  return crypto.createHash('sha256').update(base + ':hgcash-credentials:v1').digest();
}
function _credEncrypt(plain) {
  const key = _credKey(); if (!key) throw new Error('JWT_SECRET no disponible para cifrar');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function _credDecrypt(blob) {
  const key = _credKey(); if (!key || !blob) return null;
  const [iv, tag, data] = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
async function _loadHgcashCredentials() {
  try {
    const v = await getConfig('hgcashCredentials', null);
    if (!v || (!v.tokenEnc && !v.secretEnc)) {
      hgcashPay.setTokenOverride(null); _hgcashPanelSecret = null; _hgcashCredMeta = null; return;
    }
    let token = null, secret = null, decryptError = false;
    try { token = v.tokenEnc ? _credDecrypt(v.tokenEnc) : null; } catch (_) { decryptError = true; }
    try { secret = v.secretEnc ? _credDecrypt(v.secretEnc) : null; } catch (_) { decryptError = true; }
    hgcashPay.setTokenOverride(token);
    _hgcashPanelSecret = secret || null;
    _hgcashCredMeta = { tokenLast4: v.tokenLast4 || null, secretLast4: v.secretLast4 || null, updatedBy: v.updatedBy || null, updatedAt: v.updatedAt || null, decryptError };
    if (decryptError) logger.error('[hgcash] credenciales del panel NO se pudieron descifrar (¿cambió JWT_SECRET?) — se usa SSM');
  } catch (e) { logger.warn(`[hgcash] no se pudieron leer las credenciales del panel: ${e.message}`); }
}
setTimeout(() => { _loadHgcashCredentials(); }, 8 * 1000);
setInterval(() => { _loadHgcashCredentials(); }, 60 * 1000);
function _hgcashWebhookSecrets() {
  return [_hgcashPanelSecret, process.env.HGCASH_WEBHOOK_SECRET || null].filter(Boolean);
}

```

### Validación de firma del webhook (acepta panel O SSM)

Así arranca el handler `POST /api/hgcash/webhook` en este repo (la parte de la firma y el
reenvío; el resto del handler es el que cada repo ya tenga):

```js
app.post('/api/hgcash/webhook', async (req, res) => {
  try {
    const secrets = _hgcashWebhookSecrets(); // #320: panel y/o SSM
    if (secrets.length) {
      const sigHeader = req.get('X-HG-Webhook-Signature') || '';
      const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
      const provided = sigHeader.toLowerCase().startsWith('sha256=') ? sigHeader.slice(7).toLowerCase() : sigHeader.toLowerCase();
      const okSig = secrets.some((sec) => safeCompare(crypto.createHmac('sha256', sec).update(raw, 'utf8').digest('hex'), provided));
      if (!okSig) {
        // #277: ~2.000 rechazos/día en los logs del 13-14/09 sin saber de dónde
        // vienen. Se loguea el origen (IP, X-Forwarded-By del fan-out de otro
        // proyecto, UA, id/monto del payload) para identificar al emisor.
        try {
          const b = req.body || {};
          logger.warn(`[hgcash] webhook con firma inválida — rechazado (ip=${req.ip} fwdBy=${req.get('X-Forwarded-By') || '-'} ua=${String(req.get('User-Agent') || '-').slice(0, 40)} id=${b.id || b.movementId || '-'} amount=${b.amount != null ? b.amount : '-'} type=${b.type || b.eventType || b.topic || '-'} sig=${provided ? 'sí' : 'NO'})`);
        } catch (_) { logger.warn('[hgcash] webhook con firma inválida — rechazado'); }
        return res.status(401).json({ error: 'firma inválida' });
      }
    } else {
      // Fail-closed en producción: sin secreto no se puede validar la firma → NO se
      // procesa el webhook (evita inyección de movimientos/cargas falsas). En dev se permite.
      if (process.env.NODE_ENV === 'production') {
        logger.error('[hgcash] webhook RECHAZADO en producción: falta el secreto (panel → Banco automático, o HGCASH_WEBHOOK_SECRET en SSM)');
        return res.status(503).json({ error: 'webhook no configurado' });
      }
      logger.warn('[hgcash] webhook recibido SIN HGCASH_WEBHOOK_SECRET — no se valida firma (solo dev)');
    }

    // Fan-out al proyecto hermano (autoreembolsos): recién DESPUÉS de validar la
    // firma (solo se reenvían webhooks auténticos) y ANTES de cualquier filtro
    // local (el destino recibe TODO — movimientos y estados de pago — y decide
    // qué es suyo). Fire-and-forget: no bloquea nada de lo que sigue.
    _fanoutHgcashWebhook(req);
```

---

## 3) `server.js` — bloque #326 (reenvío a otras páginas)

Reemplaza el `_fanoutHgcashWebhook` viejo (que leía solo `HGCASH_FANOUT_URL`).

```js
// ============================================
// FAN-OUT del webhook hgcash → autoreembolsos
// ============================================
// hgcash permite UNA sola URL de webhook por cuenta. vipcargas la recibe y la
// reenvía al proyecto hermano (autoreembolsos, misma cuenta hgcash; cada uno
// matchea sus propios comprobantes, no hay doble carga). Se reenvía el body
// CRUDO (bytes exactos) con la firma ORIGINAL (X-HG-Webhook-Signature) para que
// el destino valide el mismo HMAC con el secret compartido. Fire-and-forget con
// 1 reintento a los 15s: si el destino está caído o lento, el procesamiento
// local NO se ve afectado en nada (ni demora la respuesta 200 a hgcash).
// URL configurable por env/SSM: HGCASH_FANOUT_URL (leída lazy — SSM carga en el
// bootstrap async). Poner 'off' para desactivar el reenvío sin deploy de código.
function _hgcashFanoutUrl() {
  const v = String(process.env.HGCASH_FANOUT_URL || '').trim();
  if (v.toLowerCase() === 'off') return null;
  return v || 'https://www.autoreembolsos.com/api/hgcash/webhook';
}

// #326 (owner 2026-10-06): los destinos del reenvío se cargan desde el PANEL
// (Banco automático → "🔁 Reenviar los avisos a otras páginas"), sin tocar SSM.
// Config['hgcashFanout'] = { urls: [...] } (hasta 5). Si ese Config EXISTE manda
// el panel (lista vacía = no reenviar a nadie); si no existe, sigue valiendo
// HGCASH_FANOUT_URL como antes. Cache de 30 s por instancia.
// Anti-círculo: (1) un aviso que YA llegó reenviado (trae X-Forwarded-By) no se
// vuelve a reenviar — la página que tiene el webhook en hgcash es la única que
// reparte, y lista a TODAS las demás; (2) nunca se reenvía a la URL propia.
const HGCASH_FANOUT_KEY = 'hgcashFanout';
const HGCASH_FANOUT_MAX = 5;
const HGCASH_FANOUT_TTL_MS = 30000;
let _hgcashFanoutCache = null; // { at, value: { source, urls } }
const _hgcashFanoutStats = new Map(); // url → { ok, fail, lastAt, lastOk, lastError } (por instancia, desde el arranque)

function _fanoutUrlKey(u) {
  try {
    const p = new URL(String(u));
    return `${p.protocol}//${p.host.toLowerCase()}${p.pathname.replace(/\/+$/, '')}`;
  } catch (_) { return String(u || '').trim().toLowerCase().replace(/\/+$/, ''); }
}
function _hgcashOwnWebhookUrl() {
  return `${getPublicBaseUrl()}/api/hgcash/webhook`;
}
// Valida una URL de destino cargada desde el panel. Tira Error con mensaje para el admin.
function _normalizeFanoutUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) throw new Error('Hay una línea vacía.');
  if (v.length > 300) throw new Error('Una de las direcciones es demasiado larga.');
  let p;
  try { p = new URL(v); } catch (_) { throw new Error(`"${v.slice(0, 60)}" no es una dirección válida (tiene que empezar con https://).`); }
  if (p.protocol !== 'https:') throw new Error(`"${p.host}": la dirección tiene que empezar con https://`);
  if (p.username || p.password) throw new Error(`"${p.host}": la dirección no puede llevar usuario ni contraseña.`);
  const host = p.hostname.toLowerCase();
  if (host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host.startsWith('[') || !host.includes('.')) {
    throw new Error(`"${host}": tiene que ser el dominio público de la otra página.`);
  }
  if (!p.pathname || p.pathname === '/') p.pathname = '/api/hgcash/webhook'; // pegaron solo el dominio
  p.hash = '';
  return p.toString();
}
async function _getHgcashFanout(opts) {
  const now = Date.now();
  if (!(opts && opts.fresh) && _hgcashFanoutCache && (now - _hgcashFanoutCache.at) < HGCASH_FANOUT_TTL_MS) {
    return _hgcashFanoutCache.value;
  }
  const raw = await getConfig(HGCASH_FANOUT_KEY, null);
  let value;
  if (raw && Array.isArray(raw.urls)) {
    value = { source: 'panel', urls: raw.urls.map((u) => String(u || '').trim()).filter(Boolean).slice(0, HGCASH_FANOUT_MAX) };
  } else {
    const envUrl = _hgcashFanoutUrl();
    value = { source: 'env', urls: envUrl ? [envUrl] : [] };
  }
  _hgcashFanoutCache = { at: now, value };
  return value;
}
function _fanoutStat(url, ok, err) {
  const st = _hgcashFanoutStats.get(url) || { ok: 0, fail: 0, lastAt: null, lastOk: null, lastError: null };
  if (ok) st.ok++; else { st.fail++; st.lastError = String(err || '').slice(0, 160); }
  st.lastAt = new Date(); st.lastOk = !!ok;
  _hgcashFanoutStats.set(url, st);
}

function _fanoutHgcashWebhook(req) {
  try {
    // Ya viene reenviado por otra página → no se reparte de nuevo (anti-círculo).
    if (req.get('X-Forwarded-By')) return;
    // Body y firma se capturan YA (sincrónico); los destinos se resuelven aparte.
    const rawBody = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const headers = {
      'Content-Type': req.get('Content-Type') || 'application/json',
      'X-Forwarded-By': 'vipcargas'
    };
    const sig = req.get('X-HG-Webhook-Signature');
    if (sig) headers['X-HG-Webhook-Signature'] = sig;
    _getHgcashFanout().then((cfg) => {
      const own = _fanoutUrlKey(_hgcashOwnWebhookUrl());
      for (const url of cfg.urls) {
        if (_fanoutUrlKey(url) === own) continue; // nunca a nosotros mismos
        _fanoutSendOne(url, rawBody, headers);
      }
    }).catch((e) => logger.warn(`[hgcash-fanout] no se pudieron leer los destinos: ${e.message}`));
  } catch (e) {
    logger.warn(`[hgcash-fanout] error preparando reenvío: ${e.message}`);
  }
}
function _fanoutSendOne(url, rawBody, headers) {
  const axios = require('axios');
  // maxRedirects:0 a propósito: un redirect (http→https, www↔apex) rompería la
  // entrega del POST — mejor que falle y quede visible en los logs y en el panel.
  const send = () => axios.post(url, rawBody, { headers, timeout: 8000, maxRedirects: 0 });
  send().then(() => _fanoutStat(url, true)).catch((e1) => {
    logger.warn(`[hgcash-fanout] ${url}: primer intento falló (${e1.message}) — reintento en 15s`);
    const t = setTimeout(() => {
      send().then(() => _fanoutStat(url, true)).catch((e2) => {
        _fanoutStat(url, false, e2.message);
        logger.warn(`[hgcash-fanout] reenvío a ${url} falló definitivamente: ${e2.message}`);
      });
    }, 15000);
    if (t.unref) t.unref();
  });
}

```

---

## 4) `server.js` — endpoints del panel (credenciales + reenvío)

```js
app.get('/api/admin/hgcash/credentials', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    await _loadHgcashCredentials();
    const m = _hgcashCredMeta || {};
    res.json({
      tokenSource: hgcashPay.getTokenSource(),        // panel | ssm | none
      panelToken: !!m.tokenLast4, panelSecret: !!m.secretLast4,
      tokenLast4: m.tokenLast4 || null, secretLast4: m.secretLast4 || null,
      updatedBy: m.updatedBy || null, updatedAt: m.updatedAt || null, decryptError: !!m.decryptError,
      ssmToken: !!process.env.HGCASH_API_TOKEN, ssmSecret: !!process.env.HGCASH_WEBHOOK_SECRET,
      webhookFullUrl: `${getPublicBaseUrl()}/api/hgcash/webhook`
    });
  } catch (e) { res.status(500).json({ error: 'Error del servidor' }); }
});
app.post('/api/admin/hgcash/credentials', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    const b = req.body || {};
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    const secret = typeof b.webhookSecret === 'string' ? b.webhookSecret.trim() : '';
    if (!token && !secret) return res.status(400).json({ error: 'Pegá el token de API y/o el secreto del webhook' });
    if (token && (token.length < 10 || token.length > 300 || /\s/.test(token))) return res.status(400).json({ error: 'El token no parece válido' });
    if (secret && (secret.length < 8 || secret.length > 300 || /\s/.test(secret))) return res.status(400).json({ error: 'El secreto no parece válido' });
    if (!_credKey()) return res.status(503).json({ error: 'No se puede cifrar ahora (falta JWT_SECRET). Usá SSM.' });
    // El token se PRUEBA contra hgcash antes de guardar: si no anda, no se pisa el que funciona.
    let accounts = null;
    if (token) {
      const t = await hgcashPay.getAccounts(token);
      if (!t.ok) return res.status(400).json({ error: 'hgcash rechazó ese token: ' + String(t.error || '').slice(0, 160) });
      accounts = (t.data || []).map((a) => ({ id: a.id, currency: a.currency, status: a.status, name: a.name || a.holderName || a.alias || null }));
    }
    const prev = (await getConfig('hgcashCredentials', null)) || {};
    const next = Object.assign({}, prev, { updatedBy: req.user.username, updatedAt: new Date() });
    if (token) { next.tokenEnc = _credEncrypt(token); next.tokenLast4 = token.slice(-4); }
    if (secret) { next.secretEnc = _credEncrypt(secret); next.secretLast4 = secret.slice(-4); }
    await setConfig('hgcashCredentials', next);
    if (token) {
      // Cuenta nueva → el accountId cacheado es de la VIEJA: se limpia y se resuelve con el token nuevo (#53).
      try { const cfg = await getHgcashConfig(); await setConfig('hgcash', Object.assign({}, cfg, { accountId: null })); } catch (_) {}
    }
    await _loadHgcashCredentials();
    logger.warn(`[hgcash] credenciales cambiadas desde el panel por ${req.user.username}: ${token ? 'token …' + token.slice(-4) : ''}${token && secret ? ' + ' : ''}${secret ? 'secreto …' + secret.slice(-4) : ''}`);
    res.json({ success: true, tokenSource: hgcashPay.getTokenSource(), accounts });
  } catch (e) { logger.warn(`[hgcash] credentials POST: ${e.message}`); res.status(500).json({ error: 'Error del servidor' }); }
});
app.delete('/api/admin/hgcash/credentials', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    await setConfig('hgcashCredentials', { tokenEnc: null, secretEnc: null, tokenLast4: null, secretLast4: null, updatedBy: req.user.username, updatedAt: new Date() });
    try { const cfg = await getHgcashConfig(); await setConfig('hgcash', Object.assign({}, cfg, { accountId: null })); } catch (_) {}
    await _loadHgcashCredentials();
    logger.warn(`[hgcash] credenciales del panel BORRADAS por ${req.user.username} → vuelve a SSM`);
    res.json({ success: true, tokenSource: hgcashPay.getTokenSource() });
  } catch (e) { res.status(500).json({ error: 'Error del servidor' }); }
});
// #326 Reenvío (fan-out) de los avisos de hgcash a otras páginas — desde el panel.
async function _hgcashFanoutPayload() {
  const cfg = await _getHgcashFanout({ fresh: true });
  const envUrl = _hgcashFanoutUrl();
  return {
    source: cfg.source,                 // panel | env
    urls: cfg.urls,
    envUrl: envUrl || null,             // lo que valdría sin config del panel
    ownUrl: _hgcashOwnWebhookUrl(),
    max: HGCASH_FANOUT_MAX,
    stats: cfg.urls.map((u) => Object.assign({ url: u }, _hgcashFanoutStats.get(u) || { ok: 0, fail: 0, lastAt: null, lastOk: null, lastError: null }))
  };
}
app.get('/api/admin/hgcash/fanout', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    res.json(await _hgcashFanoutPayload());
  } catch (e) { res.status(500).json({ error: 'Error del servidor' }); }
});
app.post('/api/admin/hgcash/fanout', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    const rawList = Array.isArray(req.body && req.body.urls) ? req.body.urls : [];
    const own = _fanoutUrlKey(_hgcashOwnWebhookUrl());
    const urls = [], seen = new Set();
    for (const raw of rawList) {
      if (!String(raw || '').trim()) continue;
      let u;
      try { u = _normalizeFanoutUrl(raw); } catch (e) { return res.status(400).json({ error: e.message }); }
      const k = _fanoutUrlKey(u);
      if (k === own) return res.status(400).json({ error: 'Esa es la dirección de ESTA página: acá van las de las OTRAS páginas.' });
      if (seen.has(k)) continue;
      seen.add(k); urls.push(u);
    }
    if (urls.length > HGCASH_FANOUT_MAX) return res.status(400).json({ error: `Máximo ${HGCASH_FANOUT_MAX} páginas.` });
    await Config.set(HGCASH_FANOUT_KEY, { urls }, req.user.username);
    _hgcashFanoutCache = null;
    logger.info(`[hgcash-fanout] ${req.user.username} configuró el reenvío desde el panel: ${urls.length ? urls.join(', ') : '(ninguno)'}`);
    res.json(Object.assign({ success: true }, await _hgcashFanoutPayload()));
  } catch (e) {
    logger.error(`[hgcash-fanout] guardar falló: ${e.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});
app.delete('/api/admin/hgcash/fanout', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    await Config.deleteOne({ key: HGCASH_FANOUT_KEY });
    _hgcashFanoutCache = null;
    logger.info(`[hgcash-fanout] ${req.user.username} borró la config del panel (vuelve a HGCASH_FANOUT_URL)`);
    res.json(Object.assign({ success: true }, await _hgcashFanoutPayload()));
  } catch (e) { res.status(500).json({ error: 'Error del servidor' }); }
});

```

Y en `GET /api/admin/hgcash/config` la línea que informa si hay secreto (panel o SSM):

```js
app.get('/api/admin/hgcash/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin general' });
    const cfg = await getHgcashConfig();
    res.json({
      config: cfg,
      // No exponemos el secreto; sólo si está cargado (para que el panel avise).
      secretConfigured: _hgcashWebhookSecrets().length > 0, // #320: panel o SSM
      aiEnabled: comprobanteAi.isEnabled(),
      webhookUrl: '/api/hgcash/webhook',
      // URL COMPLETA armada con el dominio real (getter lazy): el panel la
      // mostraba con vipcargas.com hardcodeado y confundía (owner 2026-08-05).
      webhookFullUrl: `${getPublicBaseUrl()}/api/hgcash/webhook`
    });
  } catch (error) {
```

---

## 5) Panel — `public/adminprivado2026/index.html` (dentro del form de "Banco automático")

```html
                            <!-- #320 Credenciales de la cuenta hgcash (token + secreto) desde el panel -->
                            <div id="hgcashCredBox" style="margin-top:18px;padding:14px;border:1px solid rgba(212,175,55,0.45);border-radius:10px;background:rgba(212,175,55,0.05);">
                                <h4 style="margin:0 0 6px;color:#d4af37;font-size:14px;">🔐 Cuenta hgcash conectada (token y secreto)</h4>
                                <p style="color:#aaa;font-size:12px;line-height:1.5;margin:0 0 10px;">
                                    Para <b>cambiar de cuenta hgcash</b> (se cayó una, cambió el titular) sin entrar a AWS: pegá acá el <b>token de API</b>
                                    (<code>cash_…</code>) y el <b>secreto del webhook</b> de la cuenta NUEVA. Se guardan cifrados y mandan sobre los de AWS (SSM),
                                    que quedan de respaldo. El token se prueba contra hgcash antes de guardar. Mientras cambiás, el sistema acepta los avisos
                                    firmados con el secreto viejo Y el nuevo, así no se pierde ninguna carga.
                                </p>
                                <div id="hgcashCredStatus" style="font-size:12px;color:#ccc;margin-bottom:10px;line-height:1.6;">Cargando…</div>
                                <div class="form-group">
                                    <label>Token de API (cash_…):</label>
                                    <input type="password" id="hgcashCredToken" placeholder="(dejar vacío para no cambiarlo)" autocomplete="off" style="width:100%;">
                                </div>
                                <div class="form-group">
                                    <label>Secreto del webhook:</label>
                                    <input type="password" id="hgcashCredSecret" placeholder="(dejar vacío para no cambiarlo)" autocomplete="off" style="width:100%;">
                                    <small style="color:#aaa;font-size:11px;">En el dashboard de la cuenta nueva de hgcash, configurá el webhook a: <code id="hgcashCredWebhookUrl">…</code></small>
                                </div>
                                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                                    <button class="btn-primary" onclick="saveHgcashCredentials()">🔐 Probar y guardar</button>
                                    <button class="btn btn-secondary btn-sm" onclick="clearHgcashCredentials()" title="Borra lo cargado acá y vuelve a usar el token/secreto de AWS (SSM)">↩️ Volver a usar AWS (SSM)</button>
                                    <span id="hgcashCredMsg" style="font-size:12px;color:#aaa;"></span>
                                </div>
                            </div>

                            <!-- #326 Reenvío de los avisos de hgcash a otras páginas (misma cuenta hgcash) -->
                            <div id="hgcashFanoutBox" style="margin-top:18px;padding:14px;border:1px solid rgba(83,189,235,0.45);border-radius:10px;background:rgba(83,189,235,0.05);">
                                <h4 style="margin:0 0 6px;color:#53bdeb;font-size:14px;">🔁 Reenviar los avisos de hgcash a otras páginas</h4>
                                <p style="color:#aaa;font-size:12px;line-height:1.5;margin:0 0 10px;">
                                    hgcash permite <b>UNA sola dirección de webhook por cuenta</b>. Si varias páginas comparten la misma cuenta
                                    hgcash, la página que tiene esa dirección cargada en hgcash le <b>reenvía cada aviso</b> a las demás, y cada una
                                    carga solo las transferencias de <b>sus</b> clientes (por el comprobante). Poné acá la dirección del webhook de
                                    cada una de las <b>otras</b> páginas, una por línea (máx. 5). Requisitos en la otra página: el <b>mismo secreto
                                    del webhook</b> de esta cuenta hgcash y el banco automático activado. Una página que recibe avisos reenviados no
                                    los vuelve a reenviar (no hay círculos).
                                </p>
                                <div id="hgcashFanoutStatus" style="font-size:12px;color:#ccc;margin-bottom:10px;line-height:1.6;">Cargando…</div>
                                <div class="form-group">
                                    <label>Direcciones de las otras páginas (una por línea):</label>
                                    <textarea id="hgcashFanoutUrls" rows="3" placeholder="https://otrapagina.com/api/hgcash/webhook" spellcheck="false" autocomplete="off" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
                                    <small style="color:#aaa;font-size:11px;">La dirección de ESTA página, para cargarla en la otra (o en hgcash): <code id="hgcashFanoutOwnUrl">…</code></small>
                                </div>
                                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                                    <button class="btn-primary" onclick="saveHgcashFanout()">💾 Guardar reenvío</button>
                                    <button class="btn btn-secondary btn-sm" onclick="clearHgcashFanout()" title="Borra lo cargado acá y vuelve a usar HGCASH_FANOUT_URL de AWS (SSM)">↩️ Volver a usar AWS (SSM)</button>
                                    <span id="hgcashFanoutMsg" style="font-size:12px;color:#aaa;"></span>
                                </div>
                            </div>
                        </div>
```

---

## 6) Panel — `public/adminprivado2026/admin.js`

```js
async function loadHgcashCredentials() {
    const box = document.getElementById('hgcashCredBox');
    const st = document.getElementById('hgcashCredStatus');
    if (!box) return;
    try {
        const r = await authFetch('/api/admin/hgcash/credentials');
        if (!r.ok) { box.style.display = 'none'; return; }
        box.style.display = '';
        const j = await r.json();
        const src = j.tokenSource === 'panel' ? '<b style="color:#66ff99;">PANEL</b> (token …' + escapeHtml(j.tokenLast4 || '') + ')'
            : j.tokenSource === 'ssm' ? '<b style="color:#ffd479;">AWS (SSM)</b>' : '<b style="color:#ff8080;">NINGUNO — el pago y la carga automática no andan</b>';
        const sec = j.panelSecret ? '<b style="color:#66ff99;">PANEL</b> (…' + escapeHtml(j.secretLast4 || '') + ')' + (j.ssmSecret ? ' + AWS de respaldo' : '')
            : (j.ssmSecret ? '<b style="color:#ffd479;">AWS (SSM)</b>' : '<b style="color:#ff8080;">NINGUNO — los avisos de hgcash se rechazan</b>');
        st.innerHTML = '🔑 Token en uso: ' + src + '<br>✍️ Secreto del webhook: ' + sec +
            (j.updatedBy ? '<br><span style="color:#888;">Último cambio desde el panel: ' + escapeHtml(j.updatedBy) + ' · ' + (j.updatedAt ? fmtFechaHoraAR(j.updatedAt) : '') + '</span>' : '') +
            (j.decryptError ? '<br><span style="color:#ff8080;">⚠️ Lo guardado en el panel no se pudo leer (¿cambió JWT_SECRET?). Se está usando AWS. Volvé a cargarlo.</span>' : '');
        const u = document.getElementById('hgcashCredWebhookUrl'); if (u) u.textContent = j.webhookFullUrl || '';
    } catch (_) { if (st) st.textContent = 'No se pudo leer el estado.'; }
}
async function saveHgcashCredentials() {
    const t = (document.getElementById('hgcashCredToken') || {}).value || '';
    const s = (document.getElementById('hgcashCredSecret') || {}).value || '';
    const m = document.getElementById('hgcashCredMsg');
    if (!t.trim() && !s.trim()) { if (m) { m.style.color = '#ff8080'; m.textContent = 'Pegá el token y/o el secreto.'; } return; }
    if (!confirm('¿Cambiar la cuenta hgcash conectada? Desde ahora las cargas y los pagos automáticos van a usar estos datos.')) return;
    if (m) { m.style.color = '#aaa'; m.textContent = 'Probando con hgcash…'; }
    try {
        const r = await authFetch('/api/admin/hgcash/credentials', { method: 'POST', body: JSON.stringify({ token: t.trim(), webhookSecret: s.trim() }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ ' + (j.error || 'No se pudo guardar'); } return; }
        document.getElementById('hgcashCredToken').value = '';
        document.getElementById('hgcashCredSecret').value = '';
        const acc = (j.accounts || []).map(a => (a.name || a.id) + ' (' + (a.currency || '') + ', ' + (a.status || '') + ')').join(' · ');
        if (m) { m.style.color = '#66ff99'; m.textContent = '✅ Guardado' + (acc ? ' — cuentas que ve el token: ' + acc : ''); }
        showToast('Cuenta hgcash actualizada', 'success');
        loadHgcashCredentials();
        try { loadHgcashBalance(); } catch (_) {}
    } catch (_) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ Error de conexión'; } }
}
async function clearHgcashCredentials() {
    if (!confirm('¿Borrar el token/secreto cargados en el panel y volver a usar los de AWS (SSM)?')) return;
    const m = document.getElementById('hgcashCredMsg');
    try {
        const r = await authFetch('/api/admin/hgcash/credentials', { method: 'DELETE' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ ' + (j.error || 'No se pudo'); } return; }
        if (m) { m.style.color = '#66ff99'; m.textContent = '✅ Volvió a usar AWS (SSM)'; }
        loadHgcashCredentials();
    } catch (_) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ Error de conexión'; } }
}
window.loadHgcashCredentials = loadHgcashCredentials; window.saveHgcashCredentials = saveHgcashCredentials; window.clearHgcashCredentials = clearHgcashCredentials;

// ====== #326 Reenvío (fan-out) de los avisos de hgcash a otras páginas ======
// Config['hgcashFanout'] vía /api/admin/hgcash/fanout (solo admin general). Con
// config del panel manda el panel; sin ella vale HGCASH_FANOUT_URL de AWS (SSM).
function _hgcashFanoutRender(j) {
    const st = document.getElementById('hgcashFanoutStatus');
    const ta = document.getElementById('hgcashFanoutUrls');
    const own = document.getElementById('hgcashFanoutOwnUrl');
    if (own) own.textContent = j.ownUrl || '';
    if (ta) ta.value = (j.source === 'panel' ? (j.urls || []) : []).join('\n');
    if (!st) return;
    let h;
    if (j.source === 'panel') {
        h = (j.urls && j.urls.length)
            ? '📤 Reenviando a <b style="color:#66ff99;">' + j.urls.length + ' página' + (j.urls.length === 1 ? '' : 's') + '</b> (cargado desde el PANEL)'
            : '⏸️ <b style="color:#ffd479;">Sin reenvío</b> (lista vacía cargada desde el PANEL)';
    } else {
        h = j.envUrl
            ? '📤 Reenviando a <b style="color:#ffd479;">' + escapeHtml(j.envUrl) + '</b> — valor de AWS (SSM). Cargá la lista acá abajo para manejarlo desde el panel.'
            : '⏸️ <b style="color:#ffd479;">Sin reenvío</b> — AWS (SSM) lo tiene apagado y no hay nada cargado en el panel.';
    }
    (j.stats || []).forEach(function (s) {
        let est;
        if (!s.lastAt) est = '<span style="color:#888;">todavía no se reenvió ningún aviso desde el último reinicio</span>';
        else if (s.lastOk) est = '<span style="color:#66ff99;">✅ último reenvío OK</span> · ' + fmtFechaHoraAR(s.lastAt) + ' · ' + s.ok + ' entregados' + (s.fail ? ', ' + s.fail + ' fallidos' : '');
        else est = '<span style="color:#ff8080;">❌ último reenvío FALLÓ</span> · ' + fmtFechaHoraAR(s.lastAt) + ' · ' + escapeHtml(s.lastError || '') + ' (' + s.ok + ' entregados, ' + s.fail + ' fallidos)';
        h += '<br>• <code>' + escapeHtml(s.url) + '</code><br>&nbsp;&nbsp;' + est;
    });
    st.innerHTML = h;
}
async function loadHgcashFanout() {
    const box = document.getElementById('hgcashFanoutBox');
    if (!box) return;
    try {
        const r = await authFetch('/api/admin/hgcash/fanout');
        if (!r.ok) { box.style.display = 'none'; return; }
        box.style.display = '';
        _hgcashFanoutRender(await r.json());
    } catch (_) { const st = document.getElementById('hgcashFanoutStatus'); if (st) st.textContent = 'No se pudo leer el estado.'; }
}
async function saveHgcashFanout() {
    const m = document.getElementById('hgcashFanoutMsg');
    const urls = (document.getElementById('hgcashFanoutUrls').value || '').split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    const aviso = urls.length
        ? 'Cada aviso de hgcash que reciba ESTA página se va a reenviar a:\n\n' + urls.join('\n') + '\n\nLa otra página necesita el MISMO secreto del webhook. ¿Guardar?'
        : 'La lista está vacía: ESTA página deja de reenviar los avisos de hgcash a otras. ¿Guardar?';
    if (!confirm(aviso)) return;
    try {
        const r = await authFetch('/api/admin/hgcash/fanout', { method: 'POST', body: JSON.stringify({ urls: urls }) });
        const j = await r.json().catch(function () { return {}; });
        if (!r.ok) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ ' + (j.error || 'No se pudo guardar'); } return; }
        if (m) { m.style.color = '#66ff99'; m.textContent = '✅ Guardado'; }
        _hgcashFanoutRender(j);
        showToast('Reenvío de avisos hgcash actualizado', 'success');
    } catch (_) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ Error de conexión'; } }
}
async function clearHgcashFanout() {
    if (!confirm('¿Borrar la lista cargada en el panel y volver a usar el valor de AWS (SSM), HGCASH_FANOUT_URL?')) return;
    const m = document.getElementById('hgcashFanoutMsg');
    try {
        const r = await authFetch('/api/admin/hgcash/fanout', { method: 'DELETE' });
        const j = await r.json().catch(function () { return {}; });
        if (!r.ok) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ ' + (j.error || 'No se pudo'); } return; }
        if (m) { m.style.color = '#66ff99'; m.textContent = '✅ Volvió a usar AWS (SSM)'; }
        _hgcashFanoutRender(j);
    } catch (_) { if (m) { m.style.color = '#ff8080'; m.textContent = '❌ Error de conexión'; } }
}
window.loadHgcashFanout = loadHgcashFanout; window.saveHgcashFanout = saveHgcashFanout; window.clearHgcashFanout = clearHgcashFanout;
```

Y en `loadHgcashConfig()` (cuando el GET de la config respondió OK, junto a
`loadHgcashMovements` / `loadHgcashBalance`):

```js
        loadHgcashCredentials(); // #320
        loadHgcashFanout(); // #326
```

Bumpear `CACHE_VERSION` de `admin-sw.js` para que el panel tome el HTML/JS nuevos.

---

## 7) Cómo se usa (operación)

- **Cambiar de cuenta hgcash:** en el dashboard de la cuenta NUEVA configurar el webhook
  con la URL que muestra la card (`https://<dominio>/api/hgcash/webhook`) y generar su
  secreto → en el panel pegar token + secreto → "Probar y guardar". La card tiene que decir
  "Token en uso: PANEL" y "Secreto del webhook: PANEL".
- **Sin nada en SSM:** funciona igual (solo con lo del panel). Si varios entornos comparten
  el path de SSM, cargar lo del panel en cada uno ANTES de borrar los parámetros.
- **Varias páginas con la misma cuenta hgcash:** en la página que tiene el webhook cargado
  en hgcash, listar en "🔁 Reenviar los avisos…" la URL `…/api/hgcash/webhook` de cada
  otra página. La otra página necesita el MISMO secreto del webhook y el banco automático
  activado. Si está detrás de Cloudflare: regla WAF "Skip" para `/api/hgcash/webhook`.

## 8) Pruebas

1. Token inválido → "hgcash rechazó ese token", no cambia nada. Token válido → lista la
   cuenta y el saldo hgcash del panel se actualiza.
2. Carga real con la cuenta nueva → el webhook entra (firma con el secreto nuevo) y la
   auto-carga acredita.
3. Reenvío: transferencia real → la card muestra "✅ último reenvío OK" y el movimiento
   aparece en "Movimientos del banco" de la otra página. Una página que recibe un aviso
   reenviado no lo vuelve a reenviar (sin círculos).
