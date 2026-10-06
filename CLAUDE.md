# CLAUDE.md — Contexto del proyecto VIPCARGASANTINO

> ⚠️ **LEER PRIMERO (continuidad entre sesiones).** El owner trabaja en **Tails sin
> almacenamiento persistente**: al reiniciar la PC se borra TODO lo local y vuelve a
> clonar este repo desde GitHub. Por eso el contexto vive ACÁ (en el repo), no en la
> memoria local del asistente.
>
> **REGLA PERMANENTE (los 3 docs vivos):** tras cada cambio significativo (feature,
> fix importante, decisión de diseño) mantené actualizados:
>   1. `WORKLOG.md` — QUÉ se hizo y por qué (diario de sesiones, entrada numerada).
>   2. `docs/ARCHITECTURE.md` — CÓMO funciona (si el cambio altera un flujo, modelo,
>      endpoint o agrega una trampa nueva, reflejalo ahí; corregí lo que quede stale).
>   3. `CLAUDE.md` (este archivo) — solo si cambió algo del CONTEXTO de arranque
>      (estructura, gotchas de primer nivel, reglas de trabajo).
> Commiteá y pusheá a GitHub para que la próxima sesión pueda seguir donde se dejó.
> Esta regla aplica siempre, sin que el owner tenga que pedirlo cada vez. El objetivo:
> que una sesión nueva en Tails sepa TODO leyendo estos docs, sin re-analizar el repo.
>
> Al iniciar una sesión nueva: leé `WORKLOG.md` (estado actual) y `docs/ARCHITECTURE.md`
> (mapa completo de modelos, flujos, front y trampas — actualizado 2026-07-09 tras una
> lectura de punta a punta del repo). Antes de modificar un flujo central, leé además
> el código puntual del área. El código es la verdad; los docs son el mapa.

---

## Qué es

Backend de una **sala de juegos** (mercado argentino) que opera como wrapper sobre la
plataforma externa **1girox** (Partner API REST/JSON; panel en `admin.1girox.com`).
Capta usuarios, los crea en la plataforma por API, gestiona cargas/retiros vía CBU,
reembolsos, ruleta, fueguito, referidos y campañas/publicistas. UX en PWA con
notificaciones push (FCM).

> **Migración 2026-07-31:** antes el wrapper era sobre **JUGAYGANA**
> (`admin.agentesadmin.bet`). Los 4 clientes viejos (`jugaygana.js`,
> `jugaygana-movements.js`, `src/services/jugayganaService.js`,
> `jugayganaPublisherSessions.js`) + `referralRevenueService.js` y
> `jugayganaUserLinkService.js` **siguen en el repo pero YA NADIE los importa**: se
> conservan sólo para poder revertir. No agregarles features ni tomarlos de referencia.

**Stack:** Node 20 · Express · MongoDB (Atlas) · Mongoose · Socket.IO (+ Redis adapter
para multi-instancia en AWS EB) · Firebase Admin (FCM) · AWS SNS (SMS OTP).
Deploy: AWS Elastic Beanstalk. Dominio público: vipcargas.com. Git user: jupedro2112-pixel.

## Estructura

- `server.js` (~23k líneas) — entry point. ~180 rutas, authMiddleware inline (~L2477),
  Socket.IO (~L7325), motores cron por setInterval (~L14100+), bootstrap async con SSM
  (final del archivo). Comentario dice "en migración" pero en la práctica sigue
  creciendo acá. (Los números de línea derivan con cada cambio — usar grep.)
- `config/database.js` — el `connectDB` que server.js realmente usa (TTL de mensajes,
  proxy a /src/models). **OJO: hay DOS connectDB** (este y `src/models/index.js`); el
  segundo NO se usa desde server.js. No tocar schemas en config/database.js (sólo
  define ExternalUser y UserActivity; el resto es proxy a /src/models).
- `src/services/giroxService.js` — **cliente ÚNICO de la Partner API** (altas, saldo,
  cargas, retiros, bonos, cambio de clave y login único/SSO).
- `src/services/giroxUserLinkService.js` — resuelve y cachea `User.giroxUserId`.
- `src/services/giroxPublisherKeys.js` — alta de jugadores con la API key del publicista.
- `src/utils/periodRanges.js` — rangos de fecha (ayer / semana / mes) en hora argentina.
- `jugaygana*.js` + `referralRevenueService.js` + `jugayganaUserLinkService.js` —
  **muertos**, sin consumidores. Ver la nota de migración arriba.
- `docs/ESPEC-ROLLOVER-GLOBAL-Y-MULTICUENTA-TITULAR.md` — espec portable del rollover
  global de bonos (#278) y del cruce de multicuenta por titular del comprobante (#279).
- `docs/ESPEC-REEMBOLSO-1GIROX.md` — cómo DEBE funcionar el reembolso/cashback sobre
  plata real (fórmula, datos de la API, casos de prueba) — portable a otros repos 1girox.
- `docs/CLONACION-PASO-A-PASO.txt` — runbook probado para clonar TODO el proyecto a
  otra cuenta AWS desde CloudShell (usa `scripts/aws-export-config.sh` +
  `scripts/aws-bootstrap-clone.sh`, etapas iam/ssm/redis/cert/eb/sg/https/deploy).
  `docs/CLONACION-EC2.md` = bitácora de la clonación del 2026-09-08 (cuenta
  `zamuxavier`, dominio auto1girox.com).
- `src/models/` — schemas Mongoose canónicos (fuente de verdad).
- `src/services/` — lógica (referidos, notificaciones, otp, metaCapi, fbAds, hgcash,
  comprobantes IA, analítica publicistas…).
- `public/` — PWA del cliente (namespace global `window.VIP`, SW único
  `firebase-messaging-sw.js`). `public/adminprivado2026/` — panel admin (~14k líneas
  de admin.js, cookie httpOnly; su SW es `public/admin-sw.js`, scope /adminprivado2026/).

## Cosas que NO hay que romper (gotchas)

- **SMS y auto-registro APAGADOS por default (#322, 2026-10-06):** el proyecto corre en
  cuentas de AWS sin SNS. `Config['accessSwitches']` (panel → Configuración → "📵 SMS y
  registro", solo admin general) prende/apaga SMS, registro de la PWA y altas por landing
  (defaults OFF / OFF / ON). Con el SMS apagado nada llega a SNS, los endpoints de código
  responden `SMS_DISABLED`, no se exige teléfono verificado (retiros incluidos) y el registro
  no puede abrirse. Todo SMS nuevo pasa por los wrappers `generateAndSendOTP`/`sendSMS` de
  server.js y su ruta va en `SMS_GATED_PATHS`; en el front se pregunta `VIP.flags.sms` /
  `VIP.flags.signup`. No "arreglar" esos 403/503 en código: se prende desde el panel.

- **Credenciales de hgcash (#320):** además de SSM, se pueden cargar desde el panel (cifradas
  en Config con clave derivada de JWT_SECRET; panel > SSM). Cambio de cuenta hgcash = panel →
  Banco automático, sin tocar AWS. No volver a leer `process.env.HGCASH_API_TOKEN` directo:
  usar `hgcashPay.getToken()` y `_hgcashWebhookSecrets()`.
- **JWT_SECRET y otros secrets** se cargan desde AWS SSM en el bootstrap async, NO al
  `require()`. Por eso hay lazy getters en `src/middlewares/auth.js` y rutas.
- **IDEMPOTENCIA POR `reference` (lo más importante de la plataforma nueva).** Cargas,
  retiros y bonos llevan una `reference` única por operación. Reintentar con la MISMA
  no duplica (la API devuelve `duplicate:true`). Se rompe plata en las dos direcciones:
  si dos operaciones DISTINTAS comparten reference, la segunda **no se acredita** (el
  cliente transfiere y no recibe fichas); si la reference **cambia** entre reintentos
  del mismo pago, se paga **dos veces**. Por eso cada flujo la deriva de una llave que
  ya es única y estable (id de Transaction, periodKey del reembolso, movimiento
  bancario, id del giro/payout). Ver la tabla de prefijos `vip-*` en ARCHITECTURE §.
- **Rate limit: 60 req/min** en la Partner API. Hay un limitador local (`GIROX_MAX_RPM`,
  default 55) pero es **por proceso** → con N instancias en EB el techo real es N×55 y
  el 429 sigue siendo posible (se reintenta respetando `Retry-After`).
- **Rollover ACTIVO en la plataforma:** el jugador puede tener saldo que NO puede
  retirar. Validar retiros contra `wagering.available`, **nunca** contra `balance`.
- **El netwin sale de la Partner API** (`GET /players/{username}/stats`, v1.8), por
  username y con la misma API key. ⚠️ `netwin` POSITIVO = el jugador PERDIÓ (es la base
  del reembolso); negativo = ganó. Máximo 92 días por consulta, y el rango se evalúa
  en hora argentina del lado de la plataforma. Para varios jugadores está el batch
  (`POST /players/stats/batch`, hasta 100) — es lo que hace viable el cálculo de
  comisiones de referidos sin comerse el límite de 60 req/min.
- **Reembolsos por RANGO** (Bronce 3% / Plata 6% / Oro 10%), según lo perdido EN EL
  PERÍODO que se reclama — no un acumulado. Ver `src/utils/refundTiers.js`.
  **Diario/semanal/mensual se descuentan entre sí (#297):** el diario paga lo de AYER
  día por día; el semanal y el mensual restan la BASE ya reembolsada
  (`RefundClaim.netAmount` = base efectivamente reembolsada, no la pérdida bruta).
- **Regalos = BONO de 1girox (#266, 2026-09-07).** Ruleta (bienvenida/diaria),
  reembolsos, cashback, fueguito, rakeback, nivel VIP y comisiones de referidos van por
  `girox.creditGift()` → `POST /players/{u}/bonus` con el rollover del flujo (figuran
  como **Bono** en el panel de 1girox, no como Carga). Rollover 0 = regalo directo
  (v1.10: disponible al instante, no pisa nada). Con rollover > 0 el bono PISA a un bono
  activo → `creditGift` cae a **depósito con `multiplier`** (lo de antes) si el jugador
  tiene bono en curso/sin reclamar, o si el feat no está. Al cumplir el rollover el bono
  queda "a reclamar" → se auto-reclama al entrar al casino (`_autoClaimOnEntry`,
  throttle 15 min) y tras cada depósito con bonus. NO volver a usar `depositToUser`
  para regalos. **Rollover GLOBAL (#278):** `Config['bonusRolloverGlobal']` (default ON
  x3, panel → Configuración) pisa el rollover de TODOS los bonos vía
  `girox.setRolloverResolver` (creditGift / creditUserBalance+multiplier /
  bonus_multiplier del depósito). Un flujo que NO sea bono (comisión, devolución) tiene
  que pasar `ignoreGlobalRollover:true`. Si 1girox no permite el x elegido se usa el
  permitido siguiente hacia arriba.
- **Roles:** `user`, `admin` (todo), `depositor` (solo cargas), `withdrawer` (solo
  retiros), `comunidad` (clon de depositor, sin Pagos), `publisher_admin` (solo crea
  usuarios de su publicista — lockdown via `PUBLISHER_ADMIN_ALLOWED_PATHS`).
- **Auth:** JWT por header Authorization O por cookie httpOnly `admin_api_session`
  (el panel admin usa cookie).
- **Referidos (#307 + #317):** comisión = % × netwin del referido; el % de CADA referidor
  sale de `referralTierService.resolveReferralRate(user)` (override > NIVELES por referidos
  activos, `Config['referralMilestones']` > % plano `/sys_referidos_pct`). Nunca usar
  `getReferralRateForUser` para pagar o mostrar. NADA de premios en plata por cantidad de
  referidos (estafable). El netwin del tablero sale de la MISMA función con la que se paga
  (`referralCalculationService.getReferredNetwinForRange`). Pago automático el día 1 (cron
  `_runMonthlyReferralPayout`). No reintroducir la tasa encadenada del 7%.
- **Mensajes automáticos al usuario** son editables desde la sección COMANDOS
  (comandos `/sys_*`). Usar el helper `renderSystemCommand(name, fallback, vars)` para
  cualquier mensaje automático nuevo.
- **Transaction** (cargas/retiros) es permanente (sin TTL). **Message** tiene TTL de 3
  días. La analítica de clientes se basa en Transaction.
- **Montos en PESOS.** ⚠️ Ojo si mirás código o docs viejos: JUGAYGANA trabajaba en
  centavos y todo se multiplicaba ×100. **1girox NO** — se manda el monto tal cual, con
  decimales si hace falta. Multiplicar por 100 sería cargar 100 veces de más.
- **Partner API v1.15 (2026-09-04):** `/session` va con `embed:true` (el casino oculta
  sus controles de sesión en el iframe — NO sacarlo, es el fix del usuario cruzado) y
  devuelve `logout_url`. Todo depósito SIN bono nuestro lleva `no_bonus:true` para que
  1girox no aplique sus campañas automáticas por herencia. `/stats` trae
  `bonus.granted/still_locked` (bono OTORGADO en el rango, #274): la base de reembolsos
  es `netwin − granted` (cashback: máximo con la suma local de regalos). Manual: pedir
  `Partner-API-Manual_v_1.15.pdf` al owner (no está en el repo; el bloque `bonus` está
  en la sección 2.10 del manual actualizado que mandó soporte el 2026-09-10).
- **No hay NINGUNA sesión que renovar.** Auth por `X-Api-Key` fija en todo, incluido
  el netwin. Se fueron `ensureSession`, el mutex de login, `isHtmlBlocked` y el Bearer
  del panel (con `giroxReportsService`, eliminado el 2026-07-31).
- **Lotes con regalo (#311):** el % de un lote automático usa `_loteBonusAmount` (tope
  del bono de 1ª carga a cualquier %). Desde #324 `computeAutoBonus`/`_bonusWithCap` usan
  esa MISMA fórmula: el tope (`firstChargeBonus.capArs` + `restPct`, panel) vale para todo
  bono automático en %, no solo el 100%.
  Bono canjeado por código vence a `useHours` (24 h) del canje.
- **Bonos automáticos APAGADOS por flags** (owner 2026-06-24): `INACTIVIDAD_DISABLED`
  y `BONUS_STRATEGY_DISABLED` (server.js) + `CHARGE_BONUSES_DISABLED`
  (notificationRulesService) + bonos de encuesta con `bDays=[]`. Tope 30% en TODO lo
  automático (cap de lectura en `_getActivePromoBonus` incluido).
- **Multi-instancia (AWS EB):** los crons son `setInterval` en CADA instancia; su
  idempotencia depende de índices únicos (EncuestaFire.slotKey, InactividadFire.fireKey,
  HgcashCharge.chargeKey, DailyRouletteSpin userId+dateKey). No quitar esos índices.
- **Front frágil:** cientos de `onclick` inline dependen de funciones en `window.*`
  (no renombrar exports sin actualizar el HTML/strings). Tabla de usuarios del panel
  acoplada a `USERS_LIST_FIELDS` del backend (columna nueva ⇒ sumar campo al select).
  Detalle completo de trampas en `docs/ARCHITECTURE.md` §9.

## Flujo de trabajo del asistente

1. Leer `WORKLOG.md` al iniciar.
2. Hacer el cambio. Validar sintaxis (`node --check` en archivos tocados — no hay
   node_modules local, así que no se puede correr el server; sólo syntax check).
3. **Docs, SIEMPRE y SIN que el owner lo pida** (lo pidió explícito el 2026-09-30:
   "que no tenga que decirte qué actualizar"). En el MISMO commit del cambio:
   - `WORKLOG.md`: entrada nueva arriba (numerada, bajo "Sesión AAAA-MM-DD") + la fecha
     de "Última actualización" del encabezado.
   - `docs/ARCHITECTURE.md`: si el cambio toca un flujo, modelo, endpoint, cron,
     reference `vip-*`, env o trampa → actualizar la sección correspondiente Y corregir
     lo que el cambio deje viejo (buscar con grep el nombre de la feature en todo el
     doc, no sólo agregar). Actualizar su "Última actualización".
   - `CLAUDE.md`: sólo si cambia el contexto de arranque (gotchas de primer nivel,
     estructura, reglas).
   - Si al leer algo notás que un doc quedó desactualizado aunque no sea por tu
     cambio, corregilo igual.
4. Commitear y pushear a `main` (código + docs juntos). En Tails lo no pusheado se
   pierde al reiniciar.
