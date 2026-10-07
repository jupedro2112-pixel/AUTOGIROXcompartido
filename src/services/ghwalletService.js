/**
 * Servicio GH Wallet (banco con API, #332) — paralelo a hgcash.
 *
 * Doc: https://ghwallet.net/integration. Base URL `https://ghwallet.net/api/v1`,
 * auth `Authorization: Bearer gw_live_…` (o `gw_test_…` en el ambiente de pruebas:
 * mismos endpoints, nada toca plata, las respuestas traen `test:true`).
 *
 * Qué se usa de la API (decisión con soporte de GH Wallet — Enzo, 2026-10-07):
 *   • NO se crean cobros (`POST /payments`). Un solo CVU/alias fijo para todos los
 *     jugadores (lo devuelve `GET /account`); cada transferencia entrante llega por
 *     WEBHOOK con CUIT/nombre/cuenta de quien pagó y el coelsa del comprobante.
 *   • Se acredita SOLO con el evento `payment.verified` (plata firme, 1-2 min después
 *     del `payment.paid`, que llega con `verify_state:"held"`).
 *   • Pagos (retiros): `POST /payouts` con `Idempotency-Key` (= id del payout local).
 *     ⚠️ La clave REAL viene SIN el permiso `payouts:create`: hay que pedírselo a la
 *     administración de GH Wallet, si no responde 403 `permiso_faltante`.
 *   • Firma del webhook: HMAC-SHA256 hex de `{timestamp}.{body crudo}` con el webhook
 *     secret, headers `X-Wallet-Signature` / `X-Wallet-Timestamp` (alias
 *     `X-Webhook-Signature` / `X-Webhook-Timestamp`), ventana de 5 min.
 *
 * Token: prioridad PANEL (Config cifrado, lo carga server.js en memoria al arrancar y
 * cada 60 s) > SSM (`GHWALLET_API_TOKEN`). Mismo patrón que hgcashService (#320).
 * Variables (todas lazy, SSM carga después del require):
 *   GHWALLET_API_URL        (default https://ghwallet.net/api/v1)
 *   GHWALLET_API_TOKEN      token de API (respaldo del panel)
 *   GHWALLET_WEBHOOK_SECRET secreto del webhook (respaldo del panel; lo lee server.js)
 *   GHWALLET_TIMEOUT_MS     (default 15000)
 */

const axios = require('axios');
const crypto = require('crypto');

let _tokenOverride = null;
function setTokenOverride(t) { _tokenOverride = (typeof t === 'string' && t.trim()) ? t.trim() : null; }
function getTokenSource() { return _tokenOverride ? 'panel' : (process.env.GHWALLET_API_TOKEN ? 'ssm' : 'none'); }
function getToken() { return _tokenOverride || process.env.GHWALLET_API_TOKEN || null; }
function isEnabled() { return !!getToken(); }
function baseUrl() { return String(process.env.GHWALLET_API_URL || 'https://ghwallet.net/api/v1').replace(/\/+$/, ''); }
function isTestToken(t) { return /^gw_test_/i.test(String(t || getToken() || '')); }

/**
 * Request genérico. Devuelve SIEMPRE un objeto (nunca tira):
 *   { ok, httpStatus, data, error, errorCode, retryAfter, requestId }
 * `error`/`errorCode` salen del body de GH Wallet ({error, error_code}) — la doc pide
 * ramificar por `error_code` (el texto puede cambiar, el código no).
 */
async function _request(method, path, { body, token, idempotencyKey, timeoutMs } = {}) {
  const tok = token || getToken();
  if (!tok) return { ok: false, httpStatus: 0, error: 'GHWALLET_API_TOKEN no configurado', errorCode: 'sin_token' };
  const headers = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
  try {
    const resp = await axios({
      method, url: baseUrl() + path, data: body, headers,
      timeout: Number(timeoutMs || process.env.GHWALLET_TIMEOUT_MS || 15000),
      validateStatus: () => true, maxRedirects: 0
    });
    const d = resp.data && typeof resp.data === 'object' ? resp.data : {};
    const out = {
      ok: resp.status >= 200 && resp.status < 300,
      httpStatus: resp.status,
      data: d,
      error: d.error || (resp.status >= 400 ? `HTTP ${resp.status}` : null),
      errorCode: d.error_code || null,
      retryAfter: Number(resp.headers && resp.headers['retry-after']) || Number(d.reintentar_en_segundos) || null,
      requestId: (resp.headers && resp.headers['x-request-id']) || d.request_id || null
    };
    return out;
  } catch (e) {
    return { ok: false, httpStatus: 0, data: null, error: e.message, errorCode: e.code === 'ECONNABORTED' ? 'timeout' : 'red' };
  }
}

/** Cuenta(s) de depósito: titular, CBU/CVU, alias, cuit. Sirve para PROBAR un token antes de guardarlo. */
async function getAccount(withToken) {
  const r = await _request('GET', '/account', { token: withToken });
  if (!r.ok) return r;
  const accounts = Array.isArray(r.data.accounts) ? r.data.accounts : [];
  return Object.assign(r, { accounts, test: r.data.test === true });
}

/** Saldo: { available, balance, total_earned, currency }. */
async function getBalance(withToken) {
  const r = await _request('GET', '/balance', { token: withToken });
  if (!r.ok) return r;
  return Object.assign(r, { available: Number(r.data.available) || 0, total: Number(r.data.balance) || 0, currency: r.data.currency || 'ARS', test: r.data.test === true });
}

/**
 * Retiro a CBU/CVU (22 dígitos; GH Wallet NO resuelve alias). `amount` en pesos
 * ENTEROS. `idempotencyKey` = id del payout local (reintentar con la misma devuelve
 * el mismo retiro; una key reusada para OTRO monto/destino da 409
 * idempotencia_en_conflicto). Respuesta normalizada:
 *   { ok, httpStatus, id, status ('completed'|'processing'|'pending'|'error'|...),
 *     error, errorCode, duplicateOf, needsConfirmation, recentDuplicate, retryAfter }
 * ⚠️ Mirar SIEMPRE `status`, no solo el HTTP: 200 completed = plata enviada;
 * 202 processing = en vuelo (NO reintentar: consultar por id o esperar el webhook).
 */
async function createPayout({ amount, cbuCvu, beneficiaryName, cuit, clientRef, idempotencyKey, simular }) {
  const body = {
    amount: Math.round(Number(amount)),
    beneficiary_name: String(beneficiaryName || '').slice(0, 120) || undefined,
    cbu_cvu: String(cbuCvu || '').replace(/\D/g, ''),
    cuit: cuit ? String(cuit).replace(/\D/g, '') : undefined,
    client_ref: clientRef ? String(clientRef) : undefined
  };
  if (simular) body.simular = simular; // solo ambiente de pruebas: 'completado' | 'rechazado' | 'en_vuelo'
  const r = await _request('POST', '/payouts', { body, idempotencyKey, timeoutMs: 30000 });
  const d = r.data || {};
  return Object.assign(r, {
    id: d.id ? String(d.id) : (d.duplicate_of ? String(d.duplicate_of) : null),
    status: d.status ? String(d.status).toLowerCase() : (d.estado ? String(d.estado).toLowerCase() : null),
    duplicateOf: d.duplicate_of ? String(d.duplicate_of) : null,
    needsConfirmation: d.needs_confirmation === true,
    recentDuplicate: d.recent_duplicate || null,
    montoRetenido: d.monto_retenido != null ? Number(d.monto_retenido) : null,
    motivo: d.motivo || null
  });
}

/** Estado de un retiro: status pending | processing | completed | error | rejected. */
async function getPayout(id) {
  const r = await _request('GET', `/payouts/${encodeURIComponent(String(id))}`);
  const d = r.data || {};
  return Object.assign(r, { status: d.status ? String(d.status).toLowerCase() : null, payoutError: d.error || null });
}

/** Estado de un cobro (solo diagnóstico: no creamos cobros). */
async function getPayment(id) {
  return _request('GET', `/payments/${encodeURIComponent(String(id))}`);
}

/** Avisos que GH Wallet nos mandó (diagnóstico: "¿me llegó o no?"). */
async function listWebhooks({ onlyFailed = false, limit = 20 } = {}) {
  return _request('GET', `/webhooks?limit=${Math.min(100, Math.max(1, limit))}${onlyFailed ? '&only_failed=true' : ''}`);
}

/**
 * Verifica la firma de un webhook. `secrets` = lista (panel y/o SSM): basta con que
 * UNA coincida. Devuelve { ok, reason }.
 *   reason: 'sin_secreto' | 'sin_timestamp' | 'timestamp_viejo' | 'firma_invalida' | null
 */
function verifyWebhookSignature({ rawBody, timestamp, signature, secrets, maxAgeSec = 300 }) {
  const list = (secrets || []).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'sin_secreto' };
  const ts = String(timestamp || '').trim();
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!ts || !Number.isFinite(age)) return { ok: false, reason: 'sin_timestamp' };
  if (age > maxAgeSec) return { ok: false, reason: 'timestamp_viejo' };
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const given = Buffer.from(String(signature || '').trim().toLowerCase(), 'utf8');
  for (const secret of list) {
    const expected = Buffer.from(crypto.createHmac('sha256', String(secret)).update(ts + '.' + bodyStr).digest('hex'), 'utf8');
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return { ok: true, reason: null };
  }
  return { ok: false, reason: 'firma_invalida' };
}

/** Firma un body (para el ambiente de pruebas / tests locales). */
function signWebhook(rawBody, secret, timestamp) {
  const ts = String(timestamp || Math.floor(Date.now() / 1000));
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  return { timestamp: ts, signature: crypto.createHmac('sha256', String(secret)).update(ts + '.' + bodyStr).digest('hex') };
}

module.exports = {
  setTokenOverride, getTokenSource, getToken, isEnabled, isTestToken, baseUrl,
  getAccount, getBalance, createPayout, getPayout, getPayment, listWebhooks,
  verifyWebhookSignature, signWebhook
};
