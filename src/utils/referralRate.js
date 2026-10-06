/**
 * referralRate.js — Cuánto se lleva el referidor.
 *
 * REGLA DE NEGOCIO (owner, 2026-07-31):
 *
 *     comisión del referidor = netwin del referido × 8%
 *
 * Una sola tasa, aplicada UNA sola vez. Si un referido perdió $100.000 jugando en el
 * mes, su referidor cobra $8.000 en fichas.
 *
 * ⚠️ HISTORIA — por qué esto está comentado tan fuerte:
 * El default era 7% y se aplicaba SOBRE una comisión previa (en JUGAYGANA, la que nos
 * daba el proveedor sobre el GGR). O sea, dos tasas encadenadas. Al migrar a 1girox
 * —donde el proveedor devuelve todas sus comisiones en 0— se puso un 8% en el primer
 * eslabón y quedó multiplicándose por el 7% de acá: el referidor cobraba **0,56%** del
 * netwin en vez del 8%. El encadenamiento se eliminó (ver
 * referralCalculationService.fetchReferredRevenue) y esta es ahora la ÚNICA tasa del
 * cálculo. Si alguien vuelve a multiplicar por otra cosa, se repite el bug.
 *
 * Configurable por env `GIROX_REFERRAL_COMMISSION_PCT` (en PORCENTAJE: 8 = 8%), y por
 * usuario con `referralRateOverride` (en DECIMAL: 0.08 = 8%) para acuerdos puntuales.
 */

/** Tasa por defecto, en decimal. 0.08 = 8% del netwin del referido. */
// #307 (owner 2026-09-28): baja de 8% a 3%. El valor VIVO se lee del comando
// /sys_referidos_pct (sección COMANDOS del panel) vía resolveReferralRate().
const DEFAULT_REFERRAL_RATE = 0.03;
const REFERRAL_PCT_COMMAND = '/sys_referidos_pct';
let _cmdRate = null; // último % leído del comando (decimal), lo fija resolveReferralRate()

/**
 * Tasa configurada por entorno, en decimal.
 *
 * Getter LAZY a propósito: los secrets/env se cargan desde SSM en el bootstrap async,
 * DESPUÉS de los `require()`. Leerlo en el top-level congelaría el default (mismo
 * patrón que `hgcashService.getToken()`).
 */
function getConfiguredRate() {
  if (_cmdRate != null) return _cmdRate; // #307: el comando manda
  const pct = Number(process.env.GIROX_REFERRAL_COMMISSION_PCT);
  // Sanea basura (NaN, negativos, >100) cayendo al default acordado: un porcentaje
  // inválido nunca debe traducirse en pagar de más ni en no pagar nada.
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) return pct / 100;
  return DEFAULT_REFERRAL_RATE;
}

/**
 * Tasa de comisión aplicable a un referidor.
 * @param {Object} user - documento del usuario referidor
 * @returns {number} tasa decimal (ej. 0.08 para 8%)
 */
function getReferralRateForUser(user) {
  // Override por usuario (acuerdos puntuales). Se valida el rango: un valor corrupto
  // acá se paga en plata real.
  if (user && typeof user.referralRateOverride === 'number' &&
      Number.isFinite(user.referralRateOverride) &&
      user.referralRateOverride > 0 && user.referralRateOverride <= 1) {
    return user.referralRateOverride;
  }
  return getConfiguredRate();
}

/**
 * #307: lee el % del comando /sys_referidos_pct (texto = solo el número, ej. "3"
 * o "3%"). Válido 0 < pct ≤ 100. Si el comando no existe, está vacío o es
 * inválido → env / default. Llamar ANTES de un cálculo (async).
 */
async function resolveReferralRate() {
  try {
    const { Command } = require('../models');
    const cmd = await Command.findOne({ name: REFERRAL_PCT_COMMAND, isActive: true }).lean();
    const m = cmd && cmd.response ? String(cmd.response).replace(',', '.').match(/\d+(\.\d+)?/) : null;
    const pct = m ? Number(m[0]) : NaN;
    _cmdRate = (Number.isFinite(pct) && pct > 0 && pct <= 100) ? pct / 100 : null;
  } catch (_) { _cmdRate = null; }
  return getConfiguredRate();
}

/**
 * #317 (réplica #169 del gemelo): tasa GLOBAL plana en memoria. Acá la fuente sigue
 * siendo el comando /sys_referidos_pct (#307) — server.js la relee al arrancar y cada
 * 60 s (`refreshReferralRateFromCommand`) y el endpoint /api/admin/referral-rate la
 * escribe en el comando y la fija con `setGlobalReferralRate`. null = env/default.
 * ⚠️ Esta es la tasa PLANA: la que se PAGA sale de
 * referralTierService.resolveReferralRate(user) (override > niveles > plana).
 */
function setGlobalReferralRate(rate) {
  const n = Number(rate);
  _cmdRate = (rate != null && Number.isFinite(n) && n > 0 && n <= 1) ? n : null;
}
function getGlobalReferralRate() { return getConfiguredRate(); }

module.exports = {
  DEFAULT_REFERRAL_RATE,
  REFERRAL_PCT_COMMAND,
  getConfiguredRate,
  getReferralRateForUser,
  resolveReferralRate,
  // #317: alias con nombre claro (no confundir con referralTierService.resolveReferralRate(user))
  refreshReferralRateFromCommand: resolveReferralRate,
  setGlobalReferralRate,
  getGlobalReferralRate
};
