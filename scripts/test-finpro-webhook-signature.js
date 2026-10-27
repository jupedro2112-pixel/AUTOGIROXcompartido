#!/usr/bin/env node
/**
 * Test en frío de la firma HMAC de los webhooks de Finpro (#372).
 * Corre SIN node_modules (stubea axios/winston): `node scripts/test-finpro-webhook-signature.js`.
 * Reproduce la doc: firma = HMAC-SHA256(timestamp + "." + body_json, secret), hex, headers
 * X-Webhook-Signature / X-Webhook-Timestamp (Unix en segundos).
 */
const Module = require('module');
const crypto = require('crypto');
const _load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'axios') return function () { throw new Error('axios stub: sin red en el test'); };
  if (req === 'winston') {
    const noop = () => {};
    const fmt = () => ({});
    fmt.combine = fmt; fmt.timestamp = fmt; fmt.printf = fmt; fmt.colorize = fmt; fmt.errors = fmt; fmt.json = fmt; fmt.simple = fmt; fmt.splat = fmt; fmt.metadata = fmt; fmt.label = fmt;
    return { createLogger: () => ({ error: noop, warn: noop, info: noop, http: noop, debug: noop, add: noop, on: noop }), format: fmt, transports: { Console: function () {}, File: function () {} }, addColors: noop };
  }
  return _load.apply(this, arguments);
};
const finpro = require('../src/services/finproService');

let fails = 0;
function check(name, cond, extra) { if (cond) console.log('  ✅ ' + name); else { fails++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); } }

const secret = 'secreto-de-prueba-' + crypto.randomBytes(4).toString('hex');
const otherSecret = 'otro-secreto';
const body = JSON.stringify({ notification_id: 12345, bank_id: 'creedence', webhook_type: 'notification', notification_type: 'CT', received_at: '2026-03-20T15:30:45.000Z', transaction_data: { transfer_type: 'E', coelsa_id: 'Z6OLMDN3VYMYJQ0W2E7RQ5', amount: '15000.00', cbu_from: '0000000000000000000001', cbu_to: '0000000000000000000002' } });
const now = Math.floor(Date.now() / 1000);
const ts = String(now - 5);
const sig = finpro.signWebhook(body, secret, ts);

console.log('Firma de webhooks Finpro:');
// La firma es exactamente HMAC-SHA256(ts + "." + body)
const manual = crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
check('signWebhook = HMAC-SHA256(ts + "." + body) en hex', sig === manual);
check('firma válida con el secreto correcto', finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: sig, secrets: [secret] }).ok);
check('firma válida con Buffer como rawBody', finpro.verifyWebhookSignature({ rawBody: Buffer.from(body, 'utf8'), timestamp: ts, signature: sig, secrets: [secret] }).ok);
check('acepta cualquiera de una lista de secretos (panel, ssm)', finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: sig, secrets: [otherSecret, secret] }).secretIndex === 1);
check('acepta prefijo sha256= y mayúsculas', finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: 'sha256=' + sig.toUpperCase(), secrets: [secret] }).ok);
let r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: sig, secrets: [otherSecret] });
check('rechaza secreto distinto (firma_invalida)', !r.ok && r.reason === 'firma_invalida', r);
r = finpro.verifyWebhookSignature({ rawBody: body + ' ', timestamp: ts, signature: sig, secrets: [secret] });
check('rechaza si el cuerpo cambió un byte', !r.ok && r.reason === 'firma_invalida', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: String(now - 1), signature: sig, secrets: [secret] });
check('rechaza si el timestamp no es el firmado', !r.ok && r.reason === 'firma_invalida', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: sig, secrets: [] });
check('sin secretos → sin_secreto', !r.ok && r.reason === 'sin_secreto', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: ts, signature: '', secrets: [secret] });
check('sin firma → sin_firma', !r.ok && r.reason === 'sin_firma', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: '', signature: sig, secrets: [secret] });
check('sin timestamp → sin_timestamp', !r.ok && r.reason === 'sin_timestamp', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: 'ayer', signature: sig, secrets: [secret] });
check('timestamp no numérico → timestamp_invalido', !r.ok && r.reason === 'timestamp_invalido', r);
const oldTs = String(now - 10 * 60);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: oldTs, signature: finpro.signWebhook(body, secret, oldTs), secrets: [secret] });
check('firma correcta pero de hace 10 min → timestamp_vencido (ventana default 300 s)', !r.ok && r.reason === 'timestamp_vencido', r);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: oldTs, signature: finpro.signWebhook(body, secret, oldTs), secrets: [secret], maxAgeSec: 900 });
check('la misma con maxAgeSec 900 → válida', r.ok, r);
const futTs = String(now + 10 * 60);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: futTs, signature: finpro.signWebhook(body, secret, futTs), secrets: [secret] });
check('timestamp 10 min en el futuro → vencido (ventana simétrica)', !r.ok && r.reason === 'timestamp_vencido', r);
const msTs = String((now - 3) * 1000);
r = finpro.verifyWebhookSignature({ rawBody: body, timestamp: msTs, signature: finpro.signWebhook(body, secret, msTs), secrets: [secret] });
check('timestamp en milisegundos: se tolera (se firma con el string tal cual)', r.ok, r);
check('getWebhookMaxAgeSec default = 300', finpro.getWebhookMaxAgeSec() === 300);
process.env.FINPRO_WEBHOOK_MAX_AGE_SEC = '120';
check('FINPRO_WEBHOOK_MAX_AGE_SEC=120 se respeta', finpro.getWebhookMaxAgeSec() === 120);
delete process.env.FINPRO_WEBHOOK_MAX_AGE_SEC;

console.log(fails ? `\n${fails} test(s) FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
