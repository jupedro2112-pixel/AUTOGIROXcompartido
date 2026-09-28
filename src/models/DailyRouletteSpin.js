/**
 * Spin de la Ruleta Diaria.
 *
 * Cada user puede girar UNA sola vez por día (dateKey YYYY-MM-DD en hora
 * Argentina). El índice unique sobre (userId, dateKey) bloquea race
 * conditions y reinstalls. Resultado server-side, auditable.
 *
 * Acreditación AUTOMÁTICA: ni bien gana, se debita de JUGAYGANA al saldo
 * del user. Si falla, queda status='credit_failed' para retry manual.
 *
 * Si prizeARS === 0 (sin premio), igual queda registrado para que el
 * gate del próximo día respete el "1 spin por día".
 */
const mongoose = require('mongoose');

const spinSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  userId:   { type: String, required: true, index: true },
  username: { type: String, required: true, index: true, trim: true },

  // YYYY-MM-DD en hora Argentina (ART, UTC-3). Computado server-side.
  dateKey: { type: String, required: true, index: true },

  spunAt: { type: Date, default: Date.now, immutable: true, index: true },

  // Premio ganado: monto ARS. 0 = sin premio (o premio en %).
  prizeARS: { type: Number, required: true, default: 0, min: 0 },
  prizeLabel: { type: String, default: '' }, // ej. "$10.000", "SIN PREMIO"
  // v2 (#254): la ruleta diaria también da % EXTRA en la próxima carga.
  prizeType: { type: String, enum: ['cash', 'percent', 'none'], default: 'cash' },
  prizePct: { type: Number, default: 0 },
  rolloverX: { type: Number, default: 0 },

  // Anti-fraude
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },

  // === ACREDITACIÓN AUTOMÁTICA (jugaygana) ===
  // status 'won' inmediato cuando gana, antes de intentar credit. Después
  // pasa a 'credited' si jugaygana confirma o 'credit_failed' si falla.
  // Si prizeARS=0, status='no_prize'.
  status: {
    type: String,
    // #303: 'percent_used' = el % EXTRA se aplicó en una carga (o el agente
    // cargó bonus a mano y el premio quedó consumido).
    // #305: 'percent_expired' = pasaron 24 h sin cargar → el % se perdió.
    enum: ['no_prize', 'won', 'credited', 'credit_failed', 'percent_pending', 'percent_used', 'percent_expired'],
    default: 'won',
    index: true
  },
  creditTxId: { type: String, default: null, index: true },
  creditError: { type: String, default: null },
  creditedAt: { type: Date, default: null },
  creditAttempts: { type: Number, default: 0 },
  // #303: trazabilidad del % EXTRA (premio 'percent') cuando se aplica.
  usedAt: { type: Date, default: null },
  usedBy: { type: String, default: null },          // 'auto-hgcash' | agente | 'bonus manual del agente'
  usedOnAmount: { type: Number, default: 0 },       // carga sobre la que se aplicó
  usedBonusARS: { type: Number, default: 0 }        // bono que generó (0 si el agente puso el suyo)
}, { timestamps: true });

// Garantiza 1 spin/día por user — incluso con race / reinstall.
spinSchema.index(
  { userId: 1, dateKey: 1 },
  { name: 'unique_userid_datekey', unique: true }
);
spinSchema.index(
  { username: 1, dateKey: 1 },
  { name: 'unique_username_datekey', unique: true }
);

module.exports = mongoose.models['DailyRouletteSpin'] ||
  mongoose.model('DailyRouletteSpin', spinSchema);
