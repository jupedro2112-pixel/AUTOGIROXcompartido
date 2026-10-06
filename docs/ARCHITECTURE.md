# ARCHITECTURE — Cómo funciona VIPCARGASANTINO

> Mapa arquitectónico para entender el repo y modificarlo sin romper nada.
> **No reemplaza leer el código** del área puntual que vayas a tocar — el código es la
> verdad y este doc puede quedar viejo. Si encontrás algo desactualizado acá, corregilo
> (regla permanente en CLAUDE.md: este doc se actualiza junto con WORKLOG.md).
>
> Última actualización: **2026-10-06** — trampas del entorno EB clonado (#323, §9).
> Antes ese mismo día: interruptores de SMS y registro (#322: §3, §5, §6,
> §9; SMS y auto-registro APAGADOS por default, se prenden desde el panel). De paso se
> corrigieron datos stale (§4.8 default de referidos, §5 ruteo por key del dueño, §6 admin-sw).
> Antes ese mismo día: REFERIDOS 2.0 (#317, réplica #168-#175 del gemelo):
> niveles de % por referidos activos, tablero en vivo, actividad/ranking del admin (§2, §4.6,
> §5, §8, §9). Antes ese mismo día: status de reembolsos devuelve `alreadyPaid`
> (plata cobrada en diarios/semanales, #316, §5).
> Antes: 2026-10-02 — desvío de altas nuevas a otra campaña
> (`Campaign.newSignupsTo`, #315: §2 Campaign, §5 publisher_admin).
> Antes: 2026-09-30 — limpieza de partes stale: regalos como BONO
> (#266, §4.5/§5/§9), referidos 3% (#307, §4.6/§5), reembolso diario de vuelta (#297,
> §4.1/§8), crons nuevos (§7), `giroxReportsService` fuera de §9.
> Antes: 2026-08-03 — niveles VIP por apostado acumulado (réplica de
> Stake): §2 (VipWagerMonth + campos User), §4.4 (references vip-lvl/vip-rake), §4.6
> reescrita (el scraping del panel se ELIMINÓ en la v1.9 — ahora stats por username con
> la Partner API), §4.8 (envs VIP_*, se fueron las GIROX_ADMIN_*), §5 (flujo VIP +
> reembolsos corregido), §7 (crons VIP).
> Antes: 2026-07-31 — migración JUGAYGANA → 1girox (§4, flujos de plata de §5, trampas).
> Lectura integral previa: 2026-07-09 (server.js completo, 28 modelos, servicios, PWA y
> panel). Los números de línea derivan con cada cambio — usalos como referencia
> aproximada y confirmá con grep.

Índice:
1. Visión general del negocio
2. Modelos de datos y relaciones
3. Ciclo de request / autenticación / roles
4. Integración 1girox (Partner API + panel de reportes)
5. Flujos principales (paso a paso)
6. Front-end: PWA cliente y panel admin
7. Motores automáticos / crons
8. Convenciones importantes
9. Trampas / "no rompas esto"

---

## 1. Visión general del negocio

Sala de juegos para Argentina que es un **wrapper sobre 1girox** (plataforma de juego
externa; Partner API REST/JSON, panel de administración `admin.1girox.com`, web del
jugador `1girox.com`). Hasta el 2026-07-31 la plataforma era **JUGAYGANA**
(`admin.agentesadmin.bet` / `jugaygana44.bet`) — ver §4 para la migración.
El sistema VIPCARGAS:
- Capta jugadores (pauta/publicistas/referidos/orgánico) y los crea en 1girox por API.
- Gestiona **cargas** (manuales por agente, o AUTOMÁTICAS vía banco hgcash + IA de
  comprobantes) y **retiros** (self-service con confirmación de agente y pago
  automático por hgcash).
- Da **reembolsos** sobre la pérdida real/NETWIN (diario/semanal/mensual — el diario
  volvió el 2026-09-24, #297), **ruleta
  diaria**, **fueguito** (racha), **bono instalación $5.000**, **referidos** (3% del
  netwin del referido al referidor — comando `/sys_referidos_pct`; pago automático el
  1 de cada mes, #307) y **campañas/publicistas** con
  sub-atribución por influencer.
- El "saldo real" del jugador vive en 1girox; VIPCARGAS guarda atribución, bonos,
  reclamos y el registro permanente de transacciones.
- Al casino se entra por **login único (SSO)**: el botón CASINO pide un link de acceso
  de un solo uso — el cliente ya no tipea usuario ni contraseña de la plataforma.
  Desde #265 (Partner API v1.15) la sesión se pide con `embed:true` (el casino oculta
  sus controles de sesión en el iframe → el usuario de la PWA y el del juego nunca se
  cruzan) y la API devuelve `logout_url` (fallback env `GIROX_PLAY_LOGOUT_URL`).
  Todo depósito sin bono nuestro lleva `no_bonus:true` (1girox no aplica sus campañas
  automáticas por herencia).

UX del cliente: PWA (`public/`) con chat en vivo (Socket.IO) + push (FCM). Los
agentes operan desde `public/adminprivado2026/`. Deploy: AWS Elastic Beanstalk
(posible multi-instancia → Redis para socket.io adapter, rate-limits y locks).
Secrets desde AWS SSM cargados async en el bootstrap (final de server.js).

## 2. Modelos de datos y relaciones (`src/models/`)

Todos los modelos canónicos viven en `src/models/`. `config/database.js` los
re-exporta (NO los redefine, salvo **ExternalUser** y **UserActivity** que son
exclusivos suyos) y es el `connectDB` REAL que usa server.js (TTL de mensajes con
autorreparación de índice). `src/models/index.js` tiene OTRO connectDB con las
migraciones de índices de referidos — **NO se usa desde server.js** (solo exporta
modelos); sus migraciones corren únicamente si algo llamara a ese connectDB.

### Núcleo
- **User** — jugadores y staff. Claves: `id` (uuid string — casi todo el código usa
  `id`, NO `_id`), `username` + **`usernameLower`** (copia indexada para búsquedas
  case-insensitive; la mantiene un pre-save + backfill en cada arranque — ver
  `findUserByUsernameCI`), `password` (bcrypt vía pre-save), `role`, `phone` +
  **`phoneKey`** (clave normalizada para unicidad — quita país/0/9 AR), `phoneVerified`,
  `phoneVerificationPending` (bloquea SOLO retiros), `mustChangePassword` (bloquea casi
  todo vía authMiddleware), `tokenVersion` (revocación de sesiones), `isBlocked`/
  `blockReason`. **1girox:** `giroxUserId` (ID numérico del jugador — desde la v1.9 lo
  devuelve el propio `stats` y se persiste "gratis"; ya no bloquea nada, todo va por
  username), `giroxSyncStatus`
  (`pending|synced|linked|error|invalid_username|not_applicable`), `giroxSyncError`,
  `giroxPasswordSynced` (la clave local es bcrypt irrecuperable: los migrados se crearon
  con clave random y la real se replica en el próximo login). Campos `jugaygana*`
  (`jugayganaUserId/Username/SyncStatus/SyncError`) y `source:'jugaygana'` **se conservan
  intactos para poder revertir** — ya no se usan para operar. FCM: `fcmToken` legacy + `fcmTokens[]`
  (multi-dispositivo, `context:'standalone'` = PWA instalada). Atribución:
  `acquisitionCampaign/Source/Influencer/Utm`, `createdByEmployeeId`. Referidos:
  `referralCode`, `referredByUserId`. Meta: `metaFbc/metaFbp/landingUrl`.
  Anti-multicuenta: `registrationIp/UserAgent`. Panel: `tags[]`, `adminNotes`,
  `tagHistory`. **VIP:** `lifetimeWagered` (cache de la suma de VipWagerMonth, sólo se
  actualiza con `$max`), `vipLevel` (0 = sin nivel; NUNCA baja; se avanza recién
  DESPUÉS de acreditar el bono del nivel), `vipLevelUpdatedAt`. Otros:
  `installBonusClaimed`, `notificationPlan`, `notifMonthlyCounts`,
  `loginWithoutPassword`, `withdrawalAccount`, `pendingAccessCode`.
- **Transaction** — registro PERMANENTE (sin TTL). `type`: deposit|withdrawal|bonus|
  refund|transfer|referral_commission|fire_reward|rakeback|vip_levelup.
  `metadata.source` distingue regalos ('install_bonus','welcome_gift') y devoluciones
  ('payout_refund') que se EXCLUYEN de los reportes de carga real. **Fuente de toda la
  analítica.**
- **VipWagerMonth** — apostado de casino de un usuario en un mes calendario (ART).
  Base del acumulado VIP (`User.lifetimeWagered` = suma de estos buckets). Único por
  `userId+monthKey`; el motor SIEMPRE escribe con `$set` (nunca `$inc`) → recalcular
  es idempotente y multi-instancia-safe. `closed:true` = mes terminado y recalculado
  completo (no se vuelve a consultar a la plataforma).
- **Message** — chat. **TTL 3 días** (índice sobre `timestamp`, autorreparado en
  connectDB). `senderRole` define el lado; `adminOnly:true` = solo lo ven admins;
  `metadata.kind:'welcome'` = throttle de bienvenida.
- **ChatStatus** — estado de conversación (open/closed/payments/comunidad + category
  cargas/pagos). Se crea recién con ACTIVIDAD del usuario (welcome o primer mensaje),
  no al crear la cuenta. Lleva el reloj SLA (`pendingSince/Preview/Type`).
- **ChatDelay** — snapshot permanente de demoras de atención que superaron el umbral
  (sobrevive al TTL de Message). Umbrales: cargas 2min / pagos 30min (configurables).

### Plata / banco automático (hgcash)
- **BankMovement** — cada movimiento que hgcash notifica por webhook. `matchStatus`:
  pending→claiming→shadow_matched|auto_charged|manual_charged|needs_review|duplicate|
  error|ignored. Dedupe por `movementId` único.
- **Comprobante** — cada imagen que la IA (Claude vision) clasificó como comprobante.
  `dedupeKey` (N° operación normalizado, descartando CBU/CUIT) + `imageHash` (SHA-256)
  para detectar reutilización. `bankMatchStatus` para la auto-carga. `originHolderKey`
  (#279): titular de origen normalizado para cruzar multicuenta por comprobante
  (`_findHolderConflict`: al verificar, en la auto-carga y en el fraud-check).
- **HgcashCharge** — candado de idempotencia de la carga automática: índice único por
  `chargeKey` (coelsaCode) — la MISMA transferencia se acredita UNA sola vez entre
  instancias. Si la carga falla en 1girox, el registro se BORRA para permitir retry
  (el retry manda la misma `reference`, así que no puede duplicar del otro lado).
- **PendingPayout** — retiro self-service pendiente de que un agente confirme.
  `deductAtPay:true` (flujo actual) = las fichas se descuentan AL CONFIRMAR, no al
  solicitar. `debitConfirmed` = verificación anti-retiro-fantasma (el saldo tiene que
  haber bajado de verdad). `status`: pending_review→paying→paid|failed|cancelled.

### Captación / marketing
- **Campaign** — publicista/pauta. `code` inmutable (va en la URL). **`giroxApiKey`**
  (`select:false`, texto plano, formato `pk_...`) = la cuenta del publicista en 1girox:
  una key sola reemplaza al par usuario+contraseña de sub-agente que había en JUGAYGANA
  (la jerarquía la define la key). **`hasGiroxKey`** es el espejo booleano SIN
  select:false para que el listado del panel muestre el badge sin traer el secreto —
  mantenerlo en sincronía en TODOS los caminos que escriben o limpian la key. Los campos
  `jugayganaUsername/jugayganaPassword` quedan para revertir. También `influencers[]`
  (lista fija para sub-atribución analítica).
  **`newSignupsTo` (#315):** código de otra campaña adonde van las altas NUEVAS que
  entran por ésta (landing, registro PWA, alta del publisher_admin) → se crean con la
  key del destino (otra cuenta de 1girox = venta separada) y `acquisitionCampaign`/
  `giroxOwnerCampaign` = destino. Un solo salto (`_resolveSignupCampaign`); los
  usuarios viejos no se tocan. El publicista no nota nada: `_expandSignupRedirects`
  suma el destino en su my-stats, "Mis usuarios" (badge con su código) y
  `/api/campaign-stats`. ⚠️ Para separar venta con una key de OTRA cuenta usar esto,
  NO el pool de keys: el pool es solo para keys de la MISMA cuenta (las rechaza si no
  ven a los jugadores) y "Probar la key" prueba la key GUARDADA, no la escrita.
  **⚠️ RUTEO POR DUEÑO (2026-08-05):** la key MASTER NO ve por Partner API a los
  jugadores creados bajo un sub-agente. `User.giroxOwnerCampaign` marca la campaña
  dueña (se setea en el alta del publisher_admin con key OK) y `giroxService` firma
  TODAS las operaciones de ese jugador con la key de esa campaña (keyResolver
  inyectado desde server.js, cache 60s; el batch de stats se agrupa por key).
  Consecuencia: las cargas a esos jugadores salen del SALDO del sub-agente en
  1girox — mantenerlos fondeados.
- **CampaignClick** (TTL 90 días), **InfluencerStory** (placement con costo; la
  atribución de registros es por VENTANA HORARIA calculada a demanda en
  publisherAnalyticsService).
- **Referral**: ReferralEvent (atribución, 1 por referido), ReferralCommission
  (cálculo por período `YYYY-MM`, con liquidación INCREMENTAL/delta —
  `settledOwnerRevenue`; `referralRate` = la tasa del NIVEL usada ese mes),
  ReferralPayout (pagos, soporta múltiples por período), **ReferralMilestoneClaim**
  (#317: solo historial de los premios en plata por hitos del gemelo — discontinuados,
  `POST /api/referrals/milestones/claim` → 410). Config: `referralMilestones` =
  `{enabled, minChargedARS, basePct, tiers:[{count,pct}]}` (niveles, default 3→1% /
  5→2% / 10→3%, activo = cargas reales acumuladas ≥ $3.000).

### Notificaciones / retención
- **NotificationRule** (+ Suggestion con approval-gate 48h, + NotificationHistory con
  tracking de ROI), **NotifTemplate** (tipos: invitacion|regalo|reembolso — bono_50/100
  ELIMINADOS), **ScheduledNotif** (once/daily/weekly, worker cada 60s), **PromoBonus**
  (bono de carga vigente ≤30%, 1 sola carga, cap de LECTURA a 30% en
  `_getActivePromoBonus` — los bonos de LOTE `sourceRuleCode:'lote'` están EXENTOS
  del cap y pueden ser de $ FIJO vía `montoFijoARS`; desde #263 pueden ser
  **AUTOMÁTICOS**: `autoApply:true` + `applyScope` 'first'|'all' + franja horaria
  `applyFromMin/applyToMin` (min. del día, hora AR) + `rolloverX` propio (null =
  `GIROX_BONUS_MULTIPLIER` global; va como `bonus_multiplier` del depósito vía
  `_bonusMultiplierFor`) + `usesCount/usesTotalBonus` —
  los consume `claimAutoPromoPercent` en `/api/admin/deposit` (sin bonus manual) y
  en la auto-carga hgcash, con reversión si la carga falla; prioridad ruleta
  bienvenida → diaria → 1ª carga → lote), **BonusStrategyConfig** +
  **StrategyEnrollment** (estrategia por voto de encuesta — APAGADA),
  **EncuestaVote/EncuestaFire** (motor encuesta — bonos apagados),
  **InactividadFire** (motor inactivos — APAGADO).
- **NotifBatch** (2026-08-10) — LOTE de notificaciones con regalo enviado por un
  agente (roles admin|depositor; withdrawer solo lee el historial): audiencia
  (`audienceType`: 'list' usernames pegados / 'inactive' sin login ≥ N días con
  cupo opcional, los más recientes primero / **'segment'** (#263,
  `_resolveNotifBatchSegment`): base `nodeposit` ex-cargadores sin cargar ≥ N días |
  `nologin` | `deposited` cargaron en los últimos N días, + `minDeposits`,
  `minTotalArs`, `campaign` y cupo, stats por agregación de Transaction, etiqueta
  legible en `audienceLabel` / 'all' lote completo — tope de sanidad 20k) + regalo
  (`percent` en la carga, `fixed` $ o **`none` = solo aviso** (#264: sin bono, solo
  push+chat; el compositor "Redactar notificación" y "Difusión por etiqueta" quedaron
  ocultos en `#notifLegacyTools`, código intacto)) + `validHours` (1-168). **El % tiene
  `applyMode`** (#263): 'auto' (default del panel) = el sistema lo suma SOLO en la
  carga vía PromoBonus `autoApply` — `applyScope` 'first' (una carga) | 'all' (todas
  hasta vencer) y franja horaria opcional `applyFromMin/ToMin`; 'agent' = flujo
  viejo del cartel verde + "Marcar usado". El cartel del chat muestra los auto como
  "⚡ BONO AUTOMÁTICO" (informativo, botón cancelar). **El envío lo hace un MOTOR reanudable** (`_processNotifBatchQueue`,
  cron 45s + kick al crear): cada destinatario arranca `delivery:null` y se
  procesa con CLAIM ATÓMICO ($elemMatch delivery:null → 'sending' via
  findOneAndUpdate con proyección posicional) → deploy/reinicio a mitad de lote
  se retoma solo ('sending' colgado >10 min se recupera) y dos instancias EB
  nunca duplican a nadie. El PromoBonus del modo window también lo crea el
  motor (idempotente por promoBonusId). `sendDone:true` cuando no quedan
  pendientes.
  Modo **'code'**: el código (uppercase, exclusivo del lote, sin colisión con el
  código de bienvenida ni con otro lote activo) se canjea en la PWA por el MISMO
  endpoint `/api/community-code/claim` (los lotes se chequean PRIMERO vía
  `_tryClaimNotifBatchCode`; quien no está en el lote recibe "código no válido").
  Modo **'window'**: el bono se activa a todos al enviar. El bono es un
  **PromoBonus** con `expiresAt` del lote → cartel verde del chat + "Marcar usado"
  existentes — **EXCEPTO fichas (`fixed`)**, que SIEMPRE se acreditan
  automáticas como bono girox (por código: al canjear; por tiempo: al enviar,
  las acredita el motor) vía `_creditNotifBatchGift` (`creditUserBalance` con
  `multiplier=rolloverX` del lote validado contra `bonus.multipliers`;
  reference idempotente `vip-nbatch-{batchId}-{userId}`; auto-claim v1.7;
  Transaction `source:'notif_batch'`). **Candados anti-abuso** en toda
  acreditación: topes por usuario cruzando lotes (3 créditos/24h,
  $300k/7d — constantes `NOTIF_BATCH_USER_MAX_*`) → bloqueo + ALERTA URGENTE
  (log ERROR, nota admin-only, socket `security_alert` → toast rojo en el
  panel); guard bono-sobre-bono; fallos transitorios reintentan solos (el
  recipient queda 'sending' y vence a los 10 min); lo no acreditado queda en
  `recipients[].creditError`. **Código PÚBLICO** (`isPublic:true`,
  `audienceType:'public'`): sin destinatarios ni envío (se sube a Telegram/
  redes a mano) — CUALQUIER role:user canjea una vez (append atómico a
  recipients con cupo opcional `maxClaims` vía `$expr $size`), misma mecánica
  de regalo y topes. Envío: Message de chat + `sendPushIfOffline` por destinatario, EN
  SEGUNDO PLANO (la respuesta HTTP no espera); la entrega queda en
  `recipients[].delivery` ('socket'|'push'|'none'|'error') y el canal en
  `recipients[].channel` ('app'|'browser'|'none', misma clasificación que el badge
  del chat). Endpoints: `POST /api/admin/notif-batches` (+ `/preview`),
  `GET /api/admin/notif-batches` (+ `/:id` con estado del bono por usuario, leído
  del PromoBonus). Panel: cards "🎁 Lote con regalo" y "📤 Lotes enviados" en
  Notificaciones. El depósito con bonus marca el PromoBonus activo como usado
  automáticamente (ya existía), aplica también a los de lote. **#311:** el % del lote
  automático respeta el tope del bono de 1ª carga (`_loteBonusAmount`: tope×pct +
  excedente×min(pct, restPct); `_loteCapTxt` en notas/cartel/regalo); en modo código el
  PromoBonus vence a `canje + NotifBatch.useHours` (default 24 h); `GET /notif-batches`
  suma usados/activos/vencidos por lote y `/:id` devuelve `outcome` + `summary`; franja
  con minuto HASTA inclusive; código ajeno → "no es para tu cuenta".
- **DailyRouletteSpin** — 1 giro/día (índices únicos userId+dateKey y
  username+dateKey). Auto-crédito en 1girox; `credit_failed` → retry desde panel.
- **Datos 2.0** (2026-08-10, sin modelo nuevo): `GET /api/admin/datos2?days=7..90`
  — análisis por COHORTES: cada día ART es la camada de Users registrados ese
  día; por camada: % con 1+/2+/3+ cargas reales (type deposit sin
  payout_refund), $ depositado, $/nuevo y retención D1/3/7/14/30 (última carga
  ≥ x días post-registro; cohortes sin esa edad → null, el panel muestra "—")
  + breakdown por `acquisitionCampaign` (pauta) vs creados-por-agente vs
  orgánico. Sección "📊 Datos 2.0" del panel (`loadDatos2`, admin.js). Distinta
  de "Datos" (métricas del período) y de publisherAnalytics (por publicista).
- **Review** (1 por user, moderada), **OtpCode** (TTL 5 min, hash bcrypt, 3 intentos),
  **FbAdsWebhookQueue** (cola de reintentos al sistema externo fb-ads),
  **RefundClaim** (índice único userId+type+periodKey contra doble cobro),
  **FireStreak** (racha fueguito + premios pendientes), **Config** (key/value: cbu,
  hgcash, refundPercents, fireMilestones, flags de migración one-shot, etc.),
  **Command** (comandos `/...` y mensajes automáticos `/sys_*`, `isSystem:true`).

## 3. Ciclo de request / autenticación / roles

- `authMiddleware` (server.js ~L2497): JWT del header `Authorization: Bearer` o de la
  cookie httpOnly `admin_api_session` (el panel usa cookie). Valida firma HS256, busca
  el User por `id` con select mínimo (`AUTH_USER_FIELDS` — ⚠️ si un chequeo nuevo
  necesita otro campo, sumarlo ahí), chequea isActive/isBlocked/`tokenVersion`.
  publisher_admin: lockdown contra `PUBLISHER_ADMIN_ALLOWED_PATHS`. mustChangePassword:
  solo deja pasar `MUST_CHANGE_PASSWORD_ALLOWED_PATHS` (admins se auto-limpian).
- Middlewares de rol: `adminMiddleware` (admin/depositor/withdrawer/comunidad),
  `depositorMiddleware` (admin/depositor/comunidad), `withdrawerMiddleware`
  (admin/withdrawer), `publisherAdminMiddleware`. Acciones sensibles re-chequean
  `req.user.role === 'admin'` explícito (patrón obligatorio — ver #80).
- **`src/middlewares/auth.js` es OTRO sistema de auth** (access 15m + refresh 7d,
  blacklist EN MEMORIA no compartida entre instancias) usado SOLO por las rutas de
  referidos. Lazy getters de JWT_SECRET (SSM carga después del require).
- Secrets: `loadSecretsFromSSM()` en el bootstrap async → NUNCA leer secrets al
  require; leerlos en runtime.
- Cookies admin: `admin_session` (Path=/adminprivado2026) + `admin_api_session`
  (Path=/api), 8h **deslizantes** (#277: authMiddleware las reemite cuando quedan < 3 h;
  `/api/admin/me` siempre las reemite y el panel lo llama cada 30 min →
  `refreshAdminToken`), SameSite=Strict. `GET /api/admin/me` revalida la cookie contra
  DB y devuelve un token fresco para Socket.IO.
- **Interruptores de SMS y registro (#322, 2026-10-06):** `Config['accessSwitches']`
  `{smsEnabled, registrationEnabled, landingSignupEnabled}` — defaults **OFF / OFF / ON** (el
  proyecto corre en cuentas de AWS sin SNS habilitado). `getAccessSwitches()` (server.js,
  cache 10 s por instancia) → `registrationOpen = sms && registro` (el registro verifica el
  teléfono por SMS, #141). Tres capas: (1) los wrappers `generateAndSendOTP`/`sendSMS` de
  server.js cortan antes de SNS; (2) un middleware por PATH antes de las rutas de auth
  (`SMS_GATED_PATHS` → 503 `SMS_DISABLED`; `REGISTRATION_GATED_PATHS` → 403
  `REGISTRATION_DISABLED`); (3) los candados de "teléfono verificado" (retiros, bono de
  instalación) y el teléfono del cambio de clave se saltean con el SMS apagado.
  `GET /api/config/access` (público) le dice a la PWA qué ocultar; `GET/POST
  /api/admin/access-switches` (solo admin general) lo cambia desde panel → Configuración →
  "📵 SMS y registro". ⚠️ Endpoint nuevo que mande SMS ⇒ sumarlo a `SMS_GATED_PATHS` y
  usar los wrappers (nunca `otpService`/`smsService` directo).
- Rate limiting: `generalLimiter` 300/min (keyed por cookie de sesión admin o IP; en
  memoria), `authLimiter` 10/min y `sensitiveLimiter` 10/15min (Redis compartido con
  fallback a memoria — `RedisBackedRateStore`), `smsIpLimiter`/`bulkSmsIpLimiter`/
  `registerIpLimiter` (Redis INCR+EXPIRE con fallback), `platformSessionLimiter`
  (SSO al casino: 20 cada 5 min **por userId, no por IP** — con el CGNAT de las
  telefónicas argentinas limitar por IP dejaría barrios enteros compartiendo cupo;
  además protege el presupuesto de 60 req/min de la Partner API).
- Socket.IO (~L7488): `authenticate` revalida contra DB (isActive/isBlocked/
  tokenVersion). Rooms: `admins`, `user_<id>`, `chat_<id>`. Maps `connectedUsers`/
  `connectedAdmins`. Entrega con ack-timeout 3s → fallback push FCM (socket fantasma).

## 4. Integración 1girox (Partner API + panel de reportes)

Migración hecha el **2026-07-31**. Los archivos de JUGAYGANA (`jugaygana.js`,
`jugaygana-movements.js`, `src/services/jugayganaService.js`,
`jugayganaPublisherSessions.js`, `referralRevenueService.js`,
`jugayganaUserLinkService.js`) **siguen en el repo pero NINGÚN código los importa** —
server.js los sacó de sus requires (~L428 hay una lápida explicando dónde vivían).
Quedan sólo para poder revertir; se borran más adelante. **No los uses para nada nuevo.**

### 4.1 Los módulos vivos

| Módulo | Usa | Para qué |
|---|---|---|
| `src/services/giroxService.js` | server.js (`girox.*`), migración | **Cliente ÚNICO de la Partner API.** Altas (`createPlatformUser`, `syncUserToPlatform`), consulta (`getUserInfoByName`, `getUserBalance(WithRetry)`), credenciales (`validateCredentials`, `changeUserPassword`), SSO (`createSession`, `embed:true`) y plata (`depositToUser` = cargas reales, `withdrawFromUser`, `creditGift` = TODO regalo como BONO `/bonus` con fallback a depósito+multiplier si hay bono activo/feat apagado — #266; `creditUserBalance` sin multiplier delega en `creditGift` x0). Auth por header `X-Api-Key`. Rate limit + reintentos propios. |
| `src/services/giroxUserLinkService.js` | reembolsos, referidos | `resolveGiroxUserId(userId, username)` — lee `User.giroxUserId` y, si falta, lo backfillea al vuelo (match EXACTO del nombre, doble verificación). (🪦 `giroxReportsService.js` — el que scrapeaba netwin del PANEL — se ELIMINÓ el 2026-07-31 con la v1.9: el netwin sale de `getPlayerStats` de la Partner API, ver §4.6.) |
| `src/services/giroxPublisherKeys.js` | publisher_admin create-user, panel | Alta de jugadores con la **API key de la campaña** (`Campaign.giroxApiKey`). `createUserAsPublisher`, `testKey`. `invalidateSession()` quedó como **no-op** (no hay sesiones que tirar). |
| `src/utils/periodRanges.js` | reembolsos, fueguito | Rangos hoy/semana pasada/mes pasado en hora Argentina. Eran funciones de `jugaygana.js`; son PURAS y se movieron acá para que el cliente viejo se pueda borrar. (La de "ayer" se eliminó el 2026-08-07 y VOLVIÓ con el reembolso diario, #297: `getYesterdayRangeArgentinaEpoch`.) **No tocar los strings de fecha: alimentan los `periodKey` de RefundClaim.** |
| `scripts/migrate-users-to-girox.js` | one-shot manual | Migración de la base de usuarios (ver §4.7). |

### 4.2 Qué DESAPARECIÓ (el doc viejo insistía con estas cosas)

- ❌ **Los ×100 de centavos.** 1girox trabaja en **PESOS** (admite 2 decimales).
  Multiplicar por 100 en cualquier lado sería cargar 100 veces de más.
- ❌ **Las 4 sesiones independientes / `ensureSession` / mutex de login / pool por
  publicista.** No hay login: la auth es un header `X-Api-Key` fijo. No hay token que
  venza ni sesión que invalidar → un cambio de key desde el panel tiene efecto
  inmediato en TODAS las instancias (con JUGAYGANA cada instancia de EB cacheaba su
  propio pool y sólo se invalidaba la que atendía el PUT: era un bug real).
- ❌ **El HTML de Cloudflare.** La Partner API responde JSON siempre (se pide con
  `Accept: application/json`). Ya no hace falta `isHtmlBlocked()` ni el tri-estado
  found/not_found/error de `lookupUserOrError`. **Ojo:** el PANEL de reportes SÍ está
  detrás de Cloudflare y su cliente conserva la detección de HTML.
- ❌ **`jugayganaUserId` como llave de las operaciones de plata.** Todo va por
  `username`. El ID numérico ahora sólo existe para los REPORTES (ver §4.6).

### 4.3 Rate limit — 60 req/min POR KEY ⚠️ y POR INSTANCIA

La Partner API permite **60 requests por minuto POR API KEY** (confirmado por
soporte de 1girox, 2026-08-15; prometieron subirlo a 180) y devuelve 429 al
pasarse. `giroxService` tiene un limitador local de ventana deslizante **por
key**: `GIROX_MAX_RPM` (default **55**) por cada key usada (master, consultas,
publicistas). Si hay que esperar más de 30s por un lugar en la ventana, falla
rápido con `rate_limited_local` en vez de colgar la request.

**Pool de keys de consultas (`GIROX_API_KEY_CONSULTAS`, opcional, 2026-08-15):**
una o VARIAS keys del MISMO agente que la master, separadas por coma. Si están,
las lecturas de stats (`getPlayerStats` / `getPlayersStatsBatch` → reembolsos,
VIP, referidos, datos) que irían por la master firman con la key del pool con
más lugar libre en el minuto (`_pickReadsKey`), y el tráfico de fondo no
compite con cargas/retiros/SSO. Sin la env, todo va por la master como
siempre. Las keys de PUBLICISTA no se reemplazan nunca (cada una es la única
que ve a sus jugadores).

Como la plataforma puede tener límites DISTINTOS por key (2026-08-15: subió a
180 solo algunas), cada entrada acepta sufijo **`:rpm`** con su techo local
POR INSTANCIA — ej. `pk_aaa:90,pk_bbb:30` (regla: límite de esa key ÷ N
instancias). Sin sufijo, usa `GIROX_MAX_RPM` (el techo de la master). Las keys
de PUBLICISTA tienen techo propio `GIROX_PUBLISHER_MAX_RPM` (default 30 =
60÷2 instancias) — no heredan el de la master, que desde 2026-08-15 corre en
180/min (GIROX_MAX_RPM=90). Un publicista puntual con más volumen puede tener
su override con `GIROX_PUBLISHER_KEY_RPM` (`pk_x:90,...`, 2026-08-16). La
radiografía del boot muestra todo:
`[girox] config: … keys consultas cargadas: 2 (techos 30, 30/min) ·
GIROX_MAX_RPM=90 · publicistas=30 (default)/min · cache jugador=8000ms`.

**Cache corto de saldo (2026-08-16):** `getUserInfoByName` (por donde pasan
TODAS las lecturas de saldo — `getUserBalance` la usa) tiene un cache por
username (`GIROX_PLAYER_CACHE_MS`, default 8s) + coalescing de llamadas en
vuelo. Sin esto, el poll de saldo de la PWA (cada 90s por usuario) + los guards
de bono + el status saturaban la key del publicista (30/min) — era la causa
raíz del lag. Solo cachea lecturas exitosas; se invalida en cada operación de
plata del usuario (deposit/withdraw/bonus/claim), así toda lectura post-cambio
es fresca. El DÉBITO real lo valida girox server-side; el cache es solo lectura.

⚠️ **El limitador local es POR PROCESO.** En AWS EB con N instancias el techo
real es N×GIROX_MAX_RPM por key, así que el 429 sigue siendo posible. Por eso
además se reintenta respetando el header `Retry-After`. Con 2 instancias,
`GIROX_MAX_RPM` = (límite por key)/2: **30** con el límite actual de 60, **90**
si lo suben a 180.

La misma cuota la comparte el script de migración: mientras corre, producción
sigue pidiendo saldos, cargas y retiros contra el mismo cupo de la master.

### 4.4 Idempotencia por `reference` — LA REGLA DE ORO

Cada operación de plata (deposit / withdraw / bonus) lleva una `reference` de hasta
**100 caracteres** que es su llave de idempotencia. Si se repite, 1girox NO vuelve a
mover plata: responde `duplicate:true` con los datos de la operación original.

**Regla de oro: ante timeout o error de red, reintentar SIEMPRE con la MISMA
reference.** Nunca generar una nueva para el mismo pago.

Una reference mal elegida rompe plata **en las dos direcciones**:
- Si **se repite entre operaciones distintas** → la segunda vuelve `duplicate:true` y
  el cliente **NO cobra** (parece exitosa: hay que mirar el flag).
- Si **cambia entre reintentos del mismo pago** → se paga **dos veces**.

Corolario: la reference tiene que salir de algo **estable y persistido** (un id de
Transaction generado ANTES de llamar, el periodKey del reembolso, el id del movimiento
bancario). `giroxService` genera una al vuelo si no se le pasa ninguna, pero **loguea
un warning**: eso cubre sólo los reintentos internos de esa llamada, no un reintento
del usuario o del agente.

Prefijos en uso hoy:

| Prefijo | Flujo | De dónde sale |
|---|---|---|
| `vip-dep-<txId>` | Carga manual del agente | uuid generado antes de llamar y reusado como `Transaction.id` |
| `vip-depbonus-<txId>` | Bonificación de esa misma carga | ídem (Transaction del bonus) |
| `vip-wd-<txId>` | Retiro manual del agente | ídem |
| `vip-sdep-<uuid>` | `POST /api/movements/deposit` (self-service) | uuid al vuelo |
| `vip-swd-<uuid>` | `POST /api/movements/withdraw` (self-service) | uuid al vuelo ⚠️ sin persistir: no protege contra un reintento del cliente |
| `vip-bonus-<txId>` | Bono manual desde el panel | uuid reusado como Transaction.id |
| `vip-rf-<periodKey>-<userId>` | Reembolsos | **derivada del PERÍODO, no del RefundClaim.id** (ver abajo) |
| `vip-hg-<coelsa\|movementId>` | Auto-carga hgcash | identificador del MOVIMIENTO bancario (el mismo `chargeKey` del candado) |
| `vip-roulette-<spinId>` | Premio de ruleta | id del DailyRouletteSpin |
| `vip-fire-<userId>-d<día>-<fecha>` | Premio de fueguito | userId + hito + día ART |
| `vip-install-<userId>` | Bono instalación $5.000 | userId (una sola vez en la vida) |
| `vip-payout-<payoutId>` | Débito al confirmar un retiro | PendingPayout.id |
| `vip-payoutref-<payoutId>` (+ `-chips-` / `-bonus-`) | Devolución de retiro rechazado | PendingPayout.id |
| `vip-refcom-<payoutId>` | Comisión de referidos | ReferralPayout.id (uuid persistido en Mongo ANTES de llamar; si un intento anterior quedó pending/failed se REUSA el documento ⇒ misma reference) |
| `vip-lvl-<userId>-<idx>` | Bono por alcanzar un nivel VIP | userId + índice del nivel (cada nivel se paga UNA vez en la vida; por eso NO se pueden reordenar los idx de vipLevels.js) |
| `vip-rake-<fromDateStr>-<userId>` | Rakeback semanal VIP | lunes de la semana reclamada + userId (derivada del PERÍODO, igual que los reembolsos y por el mismo motivo) |
| `vip-welcome-<userId>` | Bono sorpresa del código de bienvenida (tipo cash) | userId (uno por cuenta para siempre, como el de instalación) |

⚠️ **Por qué la del reembolso sale del período y no del id del claim** (`_refundReference`,
server.js ~L6086): si la acreditación falla, el handler BORRA el RefundClaim para que el
usuario pueda reintentar, y el reintento genera un id nuevo. Con una reference derivada
de ese id, un fallo FALSO (se acreditó pero se perdió la respuesta por timeout) pagaría
DOS VECES. Derivándola del `periodKey` (que ya es único por usuario+tipo+período), el
reintento manda la misma reference y la plataforma responde `duplicate:true`.

### 4.5 Rollover y bonos ACTIVOS en la plataforma

1girox tiene el feature "Rollover y Bonos" **activo**. Consecuencias:

- **Los retiros se validan contra `wagering.available`, NO contra `balance`.** El
  jugador puede tener saldo que todavía no puede retirar (objetivo de apuestas
  pendiente). `getUserBalance` devuelve `balance`, `available`, `locked`, `bonusLocked`.
  Validar contra `balance` ⇒ la plataforma rechaza con `rollover_locked` y queda un
  retiro colgado en el panel. El confirm de payouts (~L12898) ya usa `available`.
- **Bonos "a reclamar" (Partner API v1.7).** Un bono otorgado por
  `POST /players/{username}/bonus` **ya no se libera solo** — ni con `multiplier: 0`.
  Queda BLOQUEADO hasta que el jugador entre al casino y lo RECLAME (aparece en
  `wagering.claimable`, es el "regalito" del header).
- **Regalos = BONO de 1girox (#266, 2026-09-07) — reemplaza el "depósito libre".**
  Ruleta (bienvenida/diaria), reembolsos, cashback, fueguito, rakeback, nivel VIP y
  comisiones de referidos van por **`girox.creditGift()`** → `POST /players/{u}/bonus`
  con el rollover del flujo (figuran como **Bono** en el panel de 1girox, no como
  Carga). `creditUserBalance` sin multiplier delega en `creditGift` con rollover 0.
  - Rollover 0 = bono directo (v1.10: disponible al instante, no pisa nada).
  - Rollover > 0 PISA a un bono activo → si el jugador tiene bono en curso o sin
    reclamar (> $50) o el feat no está, `creditGift` cae a **depósito con
    `multiplier`** (nunca se le debita el bono viejo a nadie). Errores definitivos
    de `/bonus` (422 / feature_disabled / out_of_range) → depósito; errores de red →
    el caller reintenta con la MISMA reference.
  - Al cumplir el rollover el bono queda "a reclamar" → `_autoClaimOnEntry` en
    `/api/platform/session` (throttle 15 min) y tras cada depósito con bonus.
  - **NO volver a usar `depositToUser` para regalos.** Las cargas reales siguen por
    `depositToUser` (con `no_bonus:true` si no llevan bono nuestro).
- **Rollover GLOBAL de bonos (#278, 2026-09-16):** `Config['bonusRolloverGlobal']`
  `{enabled, x}` (default ON, x3; opciones 0/2/3/5/10; `GET/POST
  /api/admin/bonus-rollover`, card en Configuración). `giroxService.setRolloverResolver`
  recibe el efectivo desde server.js y lo aplica en `creditGift`, `creditUserBalance`
  con `multiplier` y el `bonus_multiplier` de `depositToUser` cuando la carga lleva bono
  → TODOS los bonos salen con el mismo rollover; `ignoreGlobalRollover:true` lo evita
  (comisiones de referidos, devoluciones de retiro). Se valida contra
  `bonus.multipliers` de la plataforma: no permitido ⇒ el siguiente permitido hacia
  arriba (`effective`/`snapped`). `applyGlobalRollover(x)` en server.js para los puntos
  donde el valor se muestra o registra.
- `depositToUser` acepta `wagering` opcional (`multiplier`, `bonus_percent`,
  `bonus_amount`, `bonus_multiplier`). Caso raro documentado: la carga se acredita pero
  el bono falla (`wagering.bonus.status === 'failed'`) → se marca `bonusFailed` y se
  loguea en ERROR. **No reintentar el depósito completo** (la reference devolvería
  duplicate): escalar a soporte de 1girox.

### 4.6 Stats por jugador — netwin y apostado (Partner API v1.8/v1.9)

**Actualizado 2026-08-03.** Desde la v1.8/v1.9 (2026-07-31, WORKLOG #101) los stats
salen de la MISMA Partner API, con la misma `X-Api-Key` y por **username**:

- `GET /players/{username}/stats?from&to` → `girox.getPlayerStats()`.
- `POST /players/stats/batch` (hasta **100 usuarios** por request) →
  `girox.getPlayersStatsBatch()`. Es lo que hace viables los referidos y el motor
  VIP sin comerse el cupo de 60 req/min.
- Devuelven `totals` + `categories.casino/sports`, cada uno con `bets_count`,
  **`wagered` (apostado)**, `payout` y `netwin` — todo en **PESOS**. Desde 2026-09-10
  (sección 2.10 del manual actualizado) también **`bonus: { granted, still_locked }`** a nivel
  jugador: bono OTORGADO en el rango y cuánto sigue bloqueado por rollover. El parser
  lo expone como `bonusGranted` / `bonusStillLocked` (0 si falta). Lo usan el cashback
  (máximo tramo a tramo con la suma local de regalos — `User.cashbackCarryGranted` se
  pliega con `cashbackCarryNet`) y los reembolsos semanal/mensual (`netwin − granted`).
  A nivel apuesta la plataforma NO sabe qué parte fue bono (saldo unificado con candado).
- ⚠️ `netwin` POSITIVO = el jugador PERDIÓ (base del reembolso); negativo = ganó.
- Rango **máximo 92 días** por consulta, evaluado en **hora argentina** del lado de
  la plataforma (`formatStatsDate` ancla a -03:00).
- **Sólo CASINO** por decisión del owner (2026-07-31): reembolsos y comisiones usan
  `casinoNetwin` (`GIROX_NETWIN_SCOPE=total` incluiría sports); el motor VIP usa
  `categories.casino.wagered` (`VIP_WAGER_SCOPE=total` ídem).
- El `not_found` del batch mezcla "no existe" y "no es tuyo" a propósito (lo aclara
  el manual): se trata igual — sin stats.

**La comisión de referidos no viene del proveedor:** 1girox devuelve todos los campos
`commission` en 0, así que la tasa es NUESTRA y se aplica UNA vez sobre el netwin del
referido. Desde #317 el % de cada referidor sale de
**`referralTierService.resolveReferralRate(user)`** (async): override por usuario
(`referralRateOverride`) > **niveles** por referidos ACTIVOS (`Config['referralMilestones']`,
si `enabled`) > **% plano** (comando `/sys_referidos_pct` → env
`GIROX_REFERRAL_COMMISSION_PCT` → 3%; en memoria vía `refreshReferralRateFromCommand`, se
relee al arrancar y cada 60 s). "Activo" = cargas reales acumuladas (`Transaction deposit`,
`metadata.source` fuera de `NON_BANK_SOURCES`) ≥ `minChargedARS`. No reintroducir la tasa
encadenada (8% × 7%). El netwin mensual por referido lo lee
`referralCalculationService.getReferredNetwinForRange` (getPlayerStats + mapStatsToRevenue,
mismo alcance que el cálculo) — lo usan el cálculo, el tablero del cliente y el admin.

**`giroxUserId`** — el propio `stats` devuelve el ID numérico del jugador y los flujos
lo persisten "gratis" (update condicional sólo si estaba vacío). Ya NO bloquea nada:
todo va por username.

🪦 **Lo que había acá antes:** `giroxReportsService.js` scrapeaba el panel
`admin.1girox.com` con un Bearer de sesión auto-renovable (base64+deflate) y el ID se
buscaba con `POST /users/fetch` (LIKE ambiguo). Era el punto más frágil de toda la
integración. **ELIMINADO el 2026-07-31** junto con `GIROX_ADMIN_USER/PASS/TOKEN`,
`GIROX_ADMIN_BASE_URL` y `GIROX_AGENT_USER_ID`.

### 4.7 Migración de la base (`scripts/migrate-users-to-girox.js`)

- **Dry-run por default**: sin flags no escribe nada (ni en Mongo ni en 1girox); para
  escribir hay que pasar `--execute`. Un argumento desconocido ABORTA. Otros flags:
  `--limit=N`, `--username=xxx`, `--retry-errors`.
- **Throttling**: cada usuario consume hasta 3 llamadas (existe? + alta + búsqueda del
  ID). Default `GIROX_MIGRATION_DELAY_MS=2500` (~24 usuarios/min). Si aparecen 429,
  **SUBIR** el delay: la cuota es compartida con producción.
- **Reanudable e idempotente**: el estado vive en Mongo (`giroxSyncStatus` /
  `giroxUserId`), no en un archivo. Los `synced`/`linked` con ID se saltean; a los que
  tienen cuenta pero les faltó el ID sólo se les reintenta el ID.
- **Las contraseñas NO se migran**: las locales son bcrypt, irrecuperables por diseño.
  Cada cuenta se crea en 1girox con una clave random fuerte que no se guarda en ningún
  lado, y el usuario queda con `giroxPasswordSynced:false`. No deja a nadie afuera: al
  casino se entra por SSO. La clave real se replica en el próximo login o cambio de
  contraseña en VIPCARGAS (server.js ~L3614) y ahí pasa a `true`.
- **No toca `jugaygana*`**: se conservan para revertir.
- Usernames válidos en 1girox: **3-18 caracteres, sólo `[A-Za-z0-9_]`**. Los que no
  pasan quedan en `giroxSyncStatus:'invalid_username'` y necesitan decisión manual.

### 4.8 Variables de entorno

Todas **lazy**: se leen en runtime, NUNCA en el `require()` (SSM carga después) —
por eso `giroxService`/`giroxReportsService`/`giroxPublisherKeys` usan getters y
construyen el cliente HTTP on-demand. Congelarlas en una const de módulo es el bug que
tenían los 4 clientes viejos.

| Variable | Default | Para qué |
|---|---|---|
| `GIROX_API_URL` | — | Base de la Partner API, sin barra final (ej. `https://api.1girox.com/api/v1`) |
| `GIROX_API_KEY` | — | Header `X-Api-Key` de la cuenta MASTER (`pk_...`). **SSM, nunca en el repo** |
| `GIROX_PLAY_URL` | `https://1girox.com` | Sitio del jugador (fallback si el SSO falla) |
| `GIROX_NETWIN_SCOPE` | `casino` | `casino` \| `total` (incluiría sports) en reembolsos/comisiones |
| `GIROX_MAX_RPM` | `55` | Techo local de requests/min **por instancia** |
| `GIROX_REFERRAL_COMMISSION_PCT` | `3` | % plano de comisión de referidos, respaldo del comando `/sys_referidos_pct` (#307; ver §4.6) |
| `VIP_USD_ARS_RATE` | `1500` | Tasa USD→ARS de los umbrales VIP (los umbrales de Stake están en USD) |
| `VIP_WAGER_SCOPE` | `casino` | Qué apostado suma para el nivel (`casino` \| `total`) |
| `VIP_WAGER_EPOCH` | `2026-07` | Primer mes que se acumula (cuando arrancó 1girox) |
| `VIP_ACTIVE_DAYS` | `3` | Días de `lastLogin` que definen "activo" para el tick de 30 min |

Opcionales/afinado: `GIROX_TIMEOUT_MS` (20000) y las `GIROX_MIGRATION_*` del script.
🪦 `GIROX_ADMIN_*` y `GIROX_AGENT_USER_ID` se fueron con el scraping del panel (#101).

Si falta la config, el arranque lo grita por consola: `girox.isEnabled()` se chequea
en el bootstrap (y `GET /api/admin/girox/health` es el diagnóstico completo).

### 4.9 Login único (SSO) — el botón CASINO

`POST /api/platform/session` (alias histórico `POST /api/auth/platform-login`,
mismo handler, ~L4250) → `girox.createSession(username)` →
`POST /players/{username}/session` de 1girox → **`redirect_url` con un código de UN
SOLO USO que vence a los 60 segundos**. No se cachea ni se persiste; el front redirige
apenas lo recibe. **No se le pide la contraseña al usuario**: ya está autenticado en
VIPCARGAS con su JWT, y el cliente nunca más necesita conocer su clave del casino.

- ⚠️ **Trampa del bloqueador de pop-ups** (`VIP.ui.enterCasino`, `public/js/ui.js`): el
  link viene de un fetch asíncrono y los navegadores —sobre todo en mobile— bloquean
  `window.open` fuera del gesto del usuario. Por eso **la pestaña se abre PRIMERO,
  vacía** (con un "🎰 Entrando al casino…"), y recién después se le cambia la URL. Si
  igual la bloquearon, se navega en la pestaña actual. Si el SSO falla, se cierra la
  pestaña y se cae al modal de acceso manual. Hay guard anti-doble-click
  (`_casinoOpening`). **No mover el `window.open` después del `await`.**
- **Auto-reparación**: si 1girox responde `player_not_found` (usuario que el script de
  migración no alcanzó, o creado mientras la migración corría), el backend lo crea al
  vuelo con una contraseña random, actualiza `giroxSyncStatus` y reintenta UNA vez.

## 5. Flujos principales

- **Registro**: ⚠️ **CERRADO por default (#322)** — solo responde con SMS + registro
  encendidos en el panel (`registrationOpen`, §3); la PWA oculta "Crear cuenta". Las altas
  siguen por agente / publisher_admin / landing de pauta (`/api/landing/signup`, su propio
  interruptor `landingSignupEnabled`, default ON). Con el registro abierto:
  `POST /api/auth/register` (user+pass + teléfono con OTP obligatorio, #141) o
  `register-quick` (link de pauta con campaignCode válido, sin SMS,
  phoneVerificationPending=true → no puede retirar hasta verificar). Crea en 1girox
  PRIMERO (`girox.syncUserToPlatform`); guarda atribución, fbc/fbp, registrationIp.
  Crea ChatStatus solo el flujo público (los usuarios creados por admin/publisher NO —
  evita chats vacíos).
- **Login**: `POST /api/auth/login` (~L3361). `findUserByUsernameCI` con
  `critical:true` (fallback regex SIEMPRE disponible — nadie queda afuera). Si no existe
  local pero SÍ en 1girox, se crea la cuenta local al vuelo (cubre jugadores que nunca
  pasaron por VIPCARGAS). Soporta login por teléfono, OTP y `temporaryCode`. Roles staff
  reciben las cookies admin. JWT 30d (registro: 90d). **Efecto lateral importante**: si
  el usuario todavía tiene `giroxPasswordSynced:false`, acá se aprovecha que la clave
  viaja en claro para replicarla en 1girox (fire-and-forget, una sola vez por usuario).
- **Alta por publisher_admin**: `giroxPublisherKeys.createUserAsPublisher(campaignCode)`
  firma el `POST /players` con la **API key de la campaña**, así el jugador queda colgado
  del publicista correcto en la jerarquía. Sin key configurada (o si falla) → fallback a
  `girox.syncUserToPlatform` con la key master. ⚠️ Si el username YA existía en 1girox,
  queda bajo el agente que lo creó primero: recrearlo con otra key NO lo mueve de rama.
  Desde #132 las operaciones de ESE jugador (cargas, retiros, bonos, saldo, stats, SSO)
  se firman con la key de su campaña dueña (`User.giroxOwnerCampaign`, ver §2 Campaign
  "RUTEO POR DUEÑO"): la master no lo ve por Partner API, y las cargas salen del saldo
  del sub-agente.
  **Multi-publicista (2026-08-07):** una cuenta publisher_admin puede tener VARIAS
  campañas (`User.publisherCampaignCodes`, lista; `publisherCampaignCode` queda como
  "principal"/compat = la primera). Los permitidos se resuelven SIEMPRE con
  `_publisherCodesOf(employee)` (server.js, unión de ambos campos). Con 2+ campañas el
  create-user exige `body.campaignCode` (validado contra su lista — un código ajeno da
  403), el selector del panel lo manda y los influencers se piden por campaña
  (`GET .../influencers?campaign=`). my-stats/users agregan sobre TODAS
  (`acquisitionCampaign: {$in}`); la lista "Mis usuarios" acepta `?campaign=` para
  filtrar y muestra a qué publicista pertenece cada usuario. La gestión del admin
  (POST/PUT `/api/admin/publisher-admins`) acepta `campaignCodes` (lista) o el legacy
  `campaignCode`.
- **Pauta / vanity URL**: `GET /:code` matchea Campaign.code exacto (DB directa) o slug
  del publisher (cache 30s). Setea cookie httpOnly `vip_campaign` (60 días) → el server
  reinyecta el código en CADA carga SPA (`renderIndexHtml`) para que "registro sin SMS"
  sea determinístico (las webviews de Meta rompen localStorage).
- **Bienvenida**: `POST /api/messages/welcome` — mensajes de SISTEMA + upsert de
  ChatStatus. Throttle 24h server-side. Guard `_isStaleClientWelcome` descarta
  bienvenidas-fantasma de PWA cacheadas viejas.
- **Chat**: HTTP `POST /api/messages/send` + socket `send_message` (misma lógica
  duplicada: validaciones, comandos `/`, SLA, comprobantes). Imagen de cliente →
  `analyzeComprobanteFromMessage` (IA, fire-and-forget) → aviso adminOnly
  (duplicado/verificado/manual) → `hgcashMatchFromComprobante`.
- **Carga manual**: `POST /api/admin/deposit` → `girox.depositToUser` con
  `reference = vip-dep-<txId>` (el uuid se genera ANTES de llamar y después se reusa
  como `Transaction.id`: así una operación de 1girox se rastrea hasta su fila local y
  viceversa). El bonus va como segunda llamada (`vip-depbonus-<txId>`); el mensaje al
  cliente refleja el resultado REAL y si el bonus falla → alerta adminOnly.
  Consume PromoBonus vigente y movimiento hgcash
  pendiente del mismo monto (`hgcashConsumeOnManualDeposit`). Mensajes `/sys_deposit*`,
  `/sys_reminder`, `/sys_install_app`, `/sys_recover_100`.
- **Meta: alcance por publicista (#250, 2026-08-28).** Slots `META_PIXEL_ID_N` +
  `META_CAPI_ACCESS_TOKEN_N` (2..9) llevan opcionalmente `META_PIXEL_PUBLISHER_N` =
  publicista (`Campaign.publisher`) y/o códigos de campaña, separados por coma. Con eso:
  (a) **CAPI** (`metaCapiService.sendEvent`): el partner recibe solo alta + FTD (#221) **y
  solo de usuarios de ese publicista** — el dueño del evento se resuelve por
  `opts.publisher/campaignCode` o por el usuario (`lastTouchCampaign → acquisitionCampaign
  → giroxOwnerCampaign` → `Campaign.publisher`, cache 5 min); (b) **pixel del navegador**:
  `GET /api/meta-pixel-id?c=CODIGO` → `pixelIdsForCampaign` = **SOLO** los partners con
  ese alcance asignado (ni el propio ni los sin asignar). Sin código → `[]` y la landing
  **no carga fbevents.js** (ningún pixel). La landing manda `c` = `resolveCampaign()`
  (`?p=`/`?campaign=`/segmento de path); sin fallback. El pixel propio recibe alta/FTD/
  todo por CAPI únicamente. Cambiar el alcance = editar SSM + reiniciar. Flags por
  slot (#284): `META_PIXEL_CAPIONLY_N=1` (solo CAPI: no se carga en la landing) y
  `META_PIXEL_ALLPURCHASES_N=1` (todas las compras, no solo FTD). Diagnóstico por
  usuario: `GET /api/admin/meta-diag?username=` (#283).
- **Ruleta de bienvenida (#214, rehecha #251 2026-08-28).** Una vez por cuenta; premio
  ponderado server-side. **Cash** → `depositToUser` con `multiplier` (rollover del premio,
  o si es 0 el global del fueguito `getFireRolloverMultiplier`) — NO `/bonus`; reference
  `vip-wroul-<userId>`. **Percent** → queda `pending` y lo consumen, con reserva atómica
  `claimWelcomeRoulettePercent(userId, usedBy)` / `revertWelcomeRoulettePercent`: (a) la
  carga manual SIN bonus del agente (prioridad sobre bono de 1ª carga), (b) la **auto-carga
  hgcash** (`usedBy:'auto-hgcash'`, prioridad sobre bono de 1ª carga), (c) la carga manual
  CON bonus del agente lo marca usado sin sumarlo, (d) botón "Marcar usado" del panel.
  Cada camino deja nota adminOnly 🎡. `GET /api/welcome-roulette/status` devuelve `prize`
  completo → el widget tiene la pantalla **"🎡 Mi premio de la ruleta"** (estado
  `roulette-prize`, reabrible desde el inicio). La rueda en sí abre en **overlay a
  pantalla completa** (`#wrOverlay`, `_renderRoulette` / `casinoRouletteClose`), no en el
  área del chat. Panel: banner `#chatRouletteBanner`
  (`GET/POST /api/admin/welcome-roulette/user/:userId[/use]`). Reset por usuario para
  pruebas (#293): `POST /api/admin/roulette/reset-user` `{userId|username, welcome,
  daily}` (solo admin general) → bienvenida a `'none'` + borra el giro de HOY de la
  diaria; emite `rewards_changed` al cliente. No devuelve lo ya acreditado.
- **Link de landing con otra sesión en el celular (#309/#309b/#312):** la PWA pregunta
  con cuál seguir; "seguir con la vieja" → `POST /api/auth/access-link/discard` desactiva
  la cuenta nueva (`duplicateOfUserId`, tag `duplicado-landing`; vieja tag
  `volvio-por-pauta`); "la nueva" → `POST /api/auth/account-replaced` bloquea la vieja
  (`replacedBy*`, tag `reemplazada`) y marca la nueva (`replacesUserId`, tag `reemplazo`).
  Listado: `GET /api/admin/campaign-returns` → panel "🔁 Volvieron por pauta".
- **Dos formas de cargar (#295).** `User.depositMode` `'auto'|'manual'|null`. El widget
  pregunta al primer "Depositar" (`casinoBotGo('deposit-mode')`); `auto` = tarjeta CBU +
  comprobante (pipeline IA/hgcash); `manual` = `casinoBotManualDeposit()` monta el chat
  real y llama `POST /api/deposit/manual-start` (mensaje `/sys_carga_manual`, throttle
  2 hs, nota adminOnly al panel). `POST /api/user/deposit-mode` guarda la elección;
  `/api/rewards/summary.depositMode` la sincroniza entre dispositivos (localStorage
  `vip_deposit_mode`). Panel: etiqueta 💬 CARGA MANUAL / ⚡ AUTO junto al nombre del chat.
- **Bonos aplicados dentro de una carga (#303):** % de ruleta diaria/bienvenida, bono
  1ª carga y lote dejan además una Transaction `bonus` propia
  (`_recordAppliedBonusTx`, `metadata.appliedOnDeposit:true` → la base del cashback
  la excluye porque ya cuenta `deposit.bonus`); el giro diario pasa a
  `percent_used` (`_markDailySpinPctUsed`). **El % EXTRA vence a las 24 h del giro
  (#305):** `_expireDailyRoulettePct` (cron 15 min + lazy en claim/status) → giro
  `percent_expired`, nota ⌛ en el chat.
- **Hub "🎁 PREMIOS" + Ruleta diaria v2 + Cashback instantáneo (#254, 2026-09-01).**
  Botón flotante `#casinoRewardsBtn` (izquierda del casino, puntito rojo si hay algo
  reclamable) → overlay `#rwHubOverlay` con 3 tarjetas; `GET /api/rewards/summary` trae
  todo en un request (el netwin del cashback sólo se consulta si el cliente cargó en 7d).
  **Ruleta diaria v2:** premios configurables en `Config['dailyRoulette']` (percent/cash/
  none + peso + rollover; gates `requireDeposits` default 1 y `requireAppInstalled`
  default off; editor en la sección Ruleta del panel, `GET/POST /api/admin/daily-roulette`).
  Cash → `depositToUser` con `multiplier` (ref `vip-roulette-<spinId>`, budget-pacing
  intacto); percent → `User.dailyRoulettePendingPct/Label` (un pendiente, el nuevo pisa),
  consumido con `claimDailyRoulettePercent`/`revert…` en carga manual (prioridad:
  bonus agente > bienvenida > diaria > 1ª carga) y hgcash. `DailyRouletteSpin` suma
  `prizeType/prizePct/rolloverX` y status `percent_pending`.
  **Cashback instantáneo:** `Config['instantCashback']` {pct 5, rolloverX 2, minArs 300,
  maxDailyArs 50000} (`GET/POST /api/admin/instant-cashback`, card en el panel).
  `reclamable = max(0, pct×(netwinHoy − cobradoHoy) − cobradoHoy)` (netwin casino del
  día ART vía Partner API; sin "reembolso del reembolso"). Reclamo: modelo
  `CashbackClaim` (índice único userId+dateKey+seq), reference `vip-cbk-<user>-<día>-<seq>`
  (reintento = misma reference → la plataforma dedupe), crédito por depósito con
  `multiplier`. Lo cobrado se DESCUENTA del reembolso semanal/mensual (claim y status).
- **Credenciales hgcash desde el panel (#320):** token de API y secreto del webhook se pueden
  cargar en panel → Banco automático → "🔐 Cuenta hgcash conectada" (solo admin general,
  `GET/POST/DELETE /api/admin/hgcash/credentials`). Se guardan CIFRADOS (AES-256-GCM, clave
  derivada de JWT_SECRET) en `Config['hgcashCredentials']`; cada instancia los carga en
  memoria al arrancar y cada 60 s (`_loadHgcashCredentials` → `hgcashPay.setTokenOverride`).
  Prioridad panel > SSM (`HGCASH_API_TOKEN`/`HGCASH_WEBHOOK_SECRET` quedan de respaldo). El
  token se prueba con `GET /accounts` antes de guardar; al cambiarlo se limpia el
  `accountId` cacheado. El webhook acepta la firma con el secreto del panel O el de SSM
  (cambio de cuenta sin perder avisos). ⚠️ Si cambia JWT_SECRET lo del panel no se descifra
  → cae a SSM y el panel lo avisa.
- **AUTO-CARGA hgcash** (`POST /api/hgcash/webhook`, firma HMAC sobre rawBody,
  fail-closed en prod): guarda BankMovement → matching contra Comprobantes por
  monto + (N° operación==coelsa/externalID, o nombre de origen + destino consistente)
  dentro de una ventana (60min desde comprobante / 10min desde movimiento). Ambigüedad
  → NO carga. `hgcashAutoCarga`: claims atómicos de movimiento y comprobante → modo
  sombra o real → **mínimo $2.000** (menor → needs_review + aviso) → candado
  HgcashCharge por coelsa → guard anti-duplicado (misma carga <8min → needs_review) →
  `depositToUser` con `reference = vip-hg-<coelsa|movementId>` (**doble candado**: el
  índice único de HgcashCharge de nuestro lado y la idempotencia de 1girox del otro) →
  Transaction + mensaje + SLA. Fallo → se BORRA el HgcashCharge y es reintentable hasta
  3 veces (la reference estable impide que el reintento duplique la carga).
  **Fan-out** (#94): reenvía el webhook crudo+firma a autoreembolsos.com
  (`HGCASH_FANOUT_URL`, 'off' para apagar).
- **Regla de APERTURA/CIERRE de chats (owner 2026-08-25/26, #243/#246):** el chat
  va a **Abiertos** SOLO cuando hace falta un agente; si todo fue automático, queda o
  vuelve a **Cerrado**. Concretamente:
  - Reabre a Abiertos (`_reopenChatForManualCharge` + socket `chat_moved` by 'sistema'):
    texto del cliente (soporte); auto-carga FALLIDA; modo sombra; bajo mínimo; posible
    duplicado (<8min); duplicado REAL por coelsa; comprobante REPETIDO por IA (mismo u
    otro usuario); match AMBIGUO; hgcash APAGADO (toda carga es manual); y comprobante
    verificado **sin transferencia que coincida**: abre **al instante**
    (`_scheduleNoMatchAlert`; `HGCASH_NOMATCH_GRACE_SEC`=0, >0 = margen opcional con
    timer en la instancia); el barrido `_runStaleComprobanteSweep` (`HGCASH_STALE_MIN`=5) queda de
    red de seguridad (reinicios). Ambos pasan por `_alertStaleComprobante` (claim
    atómico `staleAlertedAt`). Cubre banco sin API / transferencia que nunca llegó /
    datos que no matchean.
  - NO abre: imagen del cliente por sí sola; registro (nace cerrado); pedido de CBU;
    carga automática OK.
  - **Cierra por Sistema** (`_closeChatBySystem`, solo si estaba en 'open'; Pagos/
    Comunidad no se tocan): auto-carga hgcash acreditada → mensaje interno "Chat
    cerrado por: Sistema (carga automática acreditada)" + socket `chat_closed`.
  - Anti-repetición del barrido: `Comprobante.staleAlertedAt` (claim atómico) + los
    casos que ya reabrieron lo marcan (`_markComprobanteAlerted`) o cambian
    `bankMatchStatus`. Sólo comprobantes posteriores al boot del proceso (un deploy no
    abre chats viejos). Si hubo un depósito al usuario después del comprobante, no abre.
- **Retiro self-service**: `POST /api/withdrawal/request` — exige phoneVerified, lock
  anti-doble, chequeo de saldo (UX), dedup 10min → crea PendingPayout
  (`deductAtPay:true`, SIN descontar) → mueve el chat a Pagos. El AGENTE confirma:
  `POST /api/admin/payouts/:id/pay` → `_deductChipsAtConfirm` (saldo **`available`**, no
  `balance` — ver §4.5 → `withdrawFromUser` con `reference = vip-payout-<payoutId>` →
  verificación anti-fantasma de que bajó) → cash-out hgcash (externalID=payout.id =
  idempotencia; retry con accountId fresco ante 403) → webhook/poller confirma DONE →
  aviso `/sys_payout_paid` + comprobante PDF (foto vía mupdf + link permanente
  `/api/payout-receipt/:id`). Rechazo (`/cancel`): si NO se descontó → nada que
  devolver; si se descontó → devolución (split bonus/fichas para pagos legacy).
  `pay-other-bank` = pago manual (descuenta igual). Poller `_pollPayingPayouts` cada
  45s (últimas 2h) cubre webhooks perdidos.
- **Reembolsos**: `POST /api/refunds/claim/{daily|weekly|monthly}` — lock Redis,
  ventanas de `models/refunds.js` (diario: cualquier día, lo de AYER, un reclamo por
  día reembolsado; semanal: lunes/martes; mensual: desde día 7), rangos en hora ART
  de `src/utils/periodRanges.js`, NETWIN real de `girox.getPlayerStats(username, …)`
  (**sólo casino**, ver §4.6; por username, sin gate de ID). El % sale del RANGO por
  pérdida del período (`src/utils/refundTiers.js`). **Regla anti "reembolso de
  reembolso" (#297, 2026-09-24):** el DIARIO paga la pérdida de ayer día por día sin
  mirar lo previo; el SEMANAL toma la pérdida NETA de la semana y **descuenta la base
  ya reembolsada por los diarios** (`_dailyRefundBaseBetween`); el MENSUAL descuenta
  diarios + semanales del mes (`_weeklyRefundBaseInMonth`, semana = la que arranca en
  el mes). `RefundClaim.netAmount` guarda la base EFECTIVAMENTE reembolsada en ese
  reclamo (ya neta de lo previo); el % sale de la pérdida total del período y se
  aplica sobre lo que queda. El status manda `alreadyRefunded` (BASE de pérdida ya
  cubierta) y `alreadyPaid` (PLATA cobrada en esos reclamos, #316) — al cliente se le
  muestra `alreadyPaid`; mostrarle la base confundía ("Ya reembolsado $159.222"). Interruptor `Config['refundDailyEnabled']` (default ON).
  **Requieren la APP instalada (#301):** `_refundAppGate` (token FCM `standalone`,
  mismo criterio que la ruleta diaria) → `needsApp` en status y en el claim.
  El diario se había eliminado el 2026-08-07 y volvió el 2026-09-24. **Desde
  2026-08-05 los rangos son EDITABLES desde el panel y CADA PERÍODO tiene su propia
  escalera**: `Config['refundTiersByPeriod']`
  (`{daily/weekly/monthly: [{name,pct,max}]}`),
  leída SIN cache por `getRefundTiersByPeriod()` (server.js) con fallback a
  `DEFAULT_TIERS` (3/6/10%) por período si falta/es inválida. Validación en
  `refundTiers.normalizeTiers` (1-6 rangos, % 0-100, umbrales crecientes, último
  sin techo). Endpoints `GET/POST /api/admin/refund-tiers` (solo admin general);
  el POST devuelve `commandWarnings` = comandos `/sys_*` cuyo texto menciona
  porcentajes (esos se editan A MANO desde COMANDOS). El status manda
  `tiersByPeriod` (+ `tiers` legacy = la del semanal). **Mínimos para COBRAR
  (2026-08-10):** `Config['refundMinimums']` (`{weekly, monthly}`, defaults
  $1.500/$5.000, 0 = sin mínimo), leída SIN cache por `getRefundMinimums()`.
  Si el reembolso calculado da > $0 pero MENOS que el mínimo, el claim rechaza
  ANTES de la reserva atómica (no quema el período) con el mínimo VIGENTE en el
  mensaje (`belowMinimum:true, minAmount`). Se editan en la misma card de
  rangos del panel y viajan en el mismo GET/POST de refund-tiers (`minimums`
  es opcional en el body: un panel cacheado viejo no los pisa). El status
  manda `minAmount` y `belowMinimum` por período. Los viejos
  Config['refundPercents'] quedaron `enUso:false` y su card del panel fue
  reemplazada por el editor de rangos. **El RefundClaim se CREA antes de acreditar** (el índice único
  `userId+type+periodKey` es el candado atómico contra doble cobro; si el crédito
  falla se borra la reserva). El crédito va por `creditUserBalance` → `creditGift`
  (BONO de 1girox, §4.5) con la reference derivada del período.
  Ver #96 y §4.4. ⚠️ En la UI los reembolsos muestran SOLO el % — los nombres
  Bronce/Plata/Oro son del nivel VIP (abajo).
- **Niveles VIP** (2026-08-03, réplica de Stake): se sube por APOSTADO acumulado de
  por vida (buckets `VipWagerMonth`, ver §2 y el motor en
  `src/services/vipLevelService.js`). Escalera en `src/utils/vipLevels.js`: umbrales
  de Stake en USD × `VIP_USD_ARS_RATE` (1500) — Bronce $15M ARS … Diamante V $750.000M.
  Cada nivel destraba: (a) **bono one-time** al alcanzarlo (lo acredita el motor con
  `creditGift` (bono, §4.5), reference `vip-lvl-<userId>-<idx>`, aviso por chat+push vía
  `/sys_vip_levelup`; `duplicate:true` = otra instancia ya pagó → no re-notificar) y
  (b) **rakeback semanal**: `POST /api/vip/rakeback/claim` paga `rakebackPct` del
  APOSTADO de casino de la semana pasada (gane o pierda) — mismo patrón de reserva
  atómica que los reembolsos (RefundClaim type `rakeback`, periodKey
  `rake:<lunes>`, reference `vip-rake-<lunes>-<userId>`). Estado:
  `GET /api/vip/status` (nivel, progreso, escalera, rakeback). El nivel NUNCA baja;
  `lifetimeWagered` sólo se escribe con `$max`. **On/off desde el panel** (SOLO admin
  general, `GET/POST /api/admin/vip-levels` → flag `vip_levels_disabled` en Config;
  apagado = no acumula, no paga, la PWA oculta la sección; reactivar recupera todo
  solo porque los buckets se recalculan con `$set`).
- **Referidos**: preview/calculate (delta incremental sobre ledger de payouts) /
  payout (acredita con `giroxService.creditUserBalance`, `ignoreGlobalRollover:true`,
  reference `vip-refcom-<payoutId>` reusando el documento de intentos fallidos).
  Comisión = **% del nivel × netwin de casino del referido** (§4.6, #317).
  **Pago AUTOMÁTICO el día 1** (`_runMonthlyReferralPayout`, reserva
  `Config referral_autorun_<YYYY-MM>`, `adminUsername:'auto-referidos'`); los botones
  del panel siguen para casos puntuales. Ver §4.6.
  **Referidos 2.0 (#317, réplica #168-#175 del gemelo):**
  - Cliente: `GET /api/referrals/dashboard` (link, totales, tabla por referido con el
    netwin del MES en vivo — mes ART en curso, cache 15 min por usuario, concurrencia 4,
    tope 60 — y el nivel/próximo nivel). PWA: modal `#referralModal` + popup
    `#referralPromoModal` (1× cada 24 h por dispositivo — #319, `?refpromo=1` lo fuerza) + chooser de compartir
    (WhatsApp / Telegram / share nativo / copiar; texto = `/sys_referidos_compartir`).
    Ambos con z-index 2147483000 (arriba del casino y del hub). La tarjeta "Invitá y ganá"
    de PREMIOS y el banner del asistente abren ese modal; `/api/rewards/summary` manda
    `referralPct` (máximo si hay niveles), `referralMyPct` y `referralTiersOn`.
  - Link: `PUBLIC_BASE_URL/?ref=CODE` (`/linkreferido?ref=` redirige, para links viejos).
    `app.js` guarda el código 30 días (`localStorage vip_ref`), lo deja FIJO en el
    registro (`window._vipRefLocked`, prioridad sobre la pauta) y, si llegó por el link
    sin sesión, abre el registro solo.
  - Admin: `GET /api/referrals/admin/activity?months=N` (actividad, ventanas 7/30 d,
    serie diaria, mes a mes, por referidor — NO consulta 1girox), detalle del referidor
    con cargas y netwin histórico + `GET /api/admin/referrals/:userId/netwin` (netwin del
    mes en vivo, tope 80). `GET/POST /api/admin/referrals/milestones-config` (niveles) y
    `GET/POST /api/admin/referral-rate` (% plano → escribe `/sys_referidos_pct`), solo
    admin general. Panel: sección Referidos (actividad, ranking, niveles, cálculo/pago,
    referidores, detalle, pagos, auditoría) + card "🤝 Comisión de referidos" en COMANDOS.
- **Ruleta diaria** (v2, ver "Hub PREMIOS" arriba): gates configurables en
  `Config['dailyRoulette']` (cargas mínimas en los últimos `depositDays` días, default
  7 — #306; app instalada), cooldown de 24 h desde el último giro. Pick ponderado +
  **budget pacing** (si excede → SIN PREMIO). Cash → `creditGift` (bono,
  `vip-roulette-<spinId>`); `credit_failed` → retry desde el panel con la MISMA
  reference. % EXTRA → pendiente que vence a las 24 h (#305).
- **Fueguito**: reclamo diario sin requisitos; premios de hitos (editables en panel,
  Config['fireMilestones']) expiran el mismo día. Crédito con `creditGift` + rollover
  (`vip-fire-<userId>-d<día>-<fecha>`); el requisito de cargas quedó reemplazado por
  el rollover (#122).
- **Bono instalación**: NEUTRALIZADO (#234) — el banner quedaba bajo el casino y
  pisaba el 100% de 1ª carga. `installbonus.js` oculta el banner y `claim()` es no-op.
  El único bono de bienvenida es el de 1ª carga (automático, con tope #285).
- **Link de acceso de un solo uso** (2026-08-03): el admin general o un DEPOSITOR
  generan `?acceso=<token>` para un cliente (`POST /api/admin/users/:userId/access-link`,
  también desde el alta del panel; regenerar pisa el anterior). En `User` vive SOLO
  el sha256 (`accessLinkHash`). El canje (`POST /api/auth/access-link`, público +
  authLimiter) borra el hash EN EL MISMO findOneAndUpdate (single-use a prueba de
  carreras), fuerza `mustChangePassword` (salvo cuentas de LANDING) y emite el
  mismo JWT del login → la PWA (auth.js `tryAccessLink`, disparado en el arranque
  por app.js) guarda el token, limpia la URL del historial y `verifyToken()` abre
  el recuadro obligatorio de crear contraseña (estilo WhatsApp claro/oscuro; piso
  front: 8+ chars con letras y números). No hay botón de logout en la app
  (eliminado a pedido del owner).
  - **Flujo LANDING (`ir=casino`, 2026-08-19):** el canje además acepta
    `casino:true` en el body → el server genera el link SSO del casino
    (`girox.createSession`) y lo devuelve como `casinoUrl` EN LA MISMA respuesta.
    El front (`tryAccessLink`) abre el casino al instante con
    `VIP.ui.enterCasinoWithUrl(url)` — sin esperar `verifyToken`, que corre en
    paralelo y al completar deja el widget de chat de soporte ABIERTO a la
    derecha (`_casinoChatMount`, flag `_landingCasinoChat`). Si el SSO adelantado
    falla, la respuesta viene sin `casinoUrl` y el front cae al camino normal
    (`enterCasino()` → `POST /api/platform/session`).
- **Cambio de cuenta en el mismo celular (#252, 2026-08-28).** El widget del casino
  muestra "👤 Estás como X" + botón **"🔄 Cambiar de cuenta / Salir"** (`VIP.ui.casinoLogout`
  → `handleLogout`). `handleLogout` ahora también cierra el casino embebido
  (`closeCasinoFrame`, resetea `_casinoOpen`) y mata la sesión de 1girox del dispositivo
  (`_killCasinoSession`: iframe oculto con `GIROX_PLAY_LOGOUT_URL`). Toda carga del SSO pasa
  por `_loadCasinoUrlFresh(url)`: si se conoce la URL de logout, primero la navega en el
  iframe (borra la cookie de 1girox) y al `load`/1500ms carga el SSO. El canje del
  access-link cierra la sesión previa (socket/usuario) antes de asumir la nueva. **SSM
  opcional: `GIROX_PLAY_LOGOUT_URL`** (URL a la que navega "cerrar sesión" en 1girox); sin
  ella el SSO se carga directo (como antes) y se depende de que 1girox pise la sesión.
  Causa del bug: no había logout alcanzable en el formato casino → la gente cambiaba de
  usuario ADENTRO de 1girox (chat de A, casino de B), y al revés el login de la PWA no
  tocaba la cookie del iframe (casino de A, chat de B).
- **SLA demoras**: reloj en ChatStatus (`delayClockOnUserMessage`/`delayClockResolve`);
  responder (mensaje/comando/carga/retiro/CBU) o cerrar lo resuelve; sobre-umbral →
  ChatDelay. Reporte `GET /api/admin/chat-delays` (solo admin).

## 6. Front-end: PWA cliente y panel admin

### PWA (`public/`)
- Namespace global `window.VIP` (`VIP.config`/`VIP.state` en config.js; módulos IIFE:
  auth, socket, chat, ui, refunds, fire, roulette, reviews, promobonus, notifications,
  withdraw, installbonus, notifsurvey, publisherwelcome, campaign, meta-pixel, apptest,
  app). El orden real de carga está en index.html (el comentario de app.js está viejo).
- **SW único**: `firebase-messaging-sw.js` (CACHE_VERSION se bumpea por release —
  ver el valor actual en el archivo) — FCM + caché: `/js/` y `/css/`
  stale-while-revalidate (deploy llega en la SIGUIENTE carga sin bumpear versión),
  `/app.js` y manifest network-first, API/socket nunca. `user-sw.js` es un stub de
  auto-desregistro (no volver a registrarlo).
- **Header del chatScreen** (2026-08-03): [botón Información | menú hamburguesa ☰].
  TODAS las acciones (referidos, soporte con ícono de auricular, notificaciones,
  instalar app, canal, configuración, logout) viven en el desplegable `#mainMenu`
  DENTRO del `<header>`. ⚠️ Los IDs de los botones son los históricos — el JS los
  cablea por id; el inline de FCM reescribe el innerHTML de `#notificationBtn`.
- **Barra de escribir estilo WhatsApp** (réplica de foto del owner): íconos SVG de
  trazo fino sin fondo (`.wa-icon-btn`) — tarjeta = CBU, cámara = foto — + send
  verde. El fueguito NO va ahí: vive en la cabecera del chat (`.fire-topbar-btn`
  en `.chat-topbar`, ids fireBtn/fireStreak intactos). Modo oscuro vía `body.wa-dark`.
- **FCM**: todo el manejo real (getToken 3 tiers, refresh, register-token) está en el
  INLINE de index.html; `window.sendFcmTokenAfterLogin` del inline pisa a propósito la
  de notifications.js. Firebase config duplicada en index.html Y en el SW (cambiar
  ambas). iOS: push solo en PWA instalada.
- SPA sin router: `#loginScreen`/`#chatScreen` + modales. **Modo invitado (#288):** sin
  sesión no se ve `#loginScreen` sino el overlay del casino con el sitio público de 1girox
  y el `.login-box` MUDADO adentro del widget (`enterCasinoGuest` / `_guestExit` en ui.js;
  el overlay baja a z-index 9000 para que los modales queden arriba). Estado de login en globals
  `window._loginMode` etc. Interceptor global de fetch (auth.js) reabre el modal
  obligatorio ante 403 MUST_CHANGE_PASSWORD.
- Server-side rendering mínimo: `renderIndexHtml` reemplaza placeholders
  (`__META_PIXEL_ID_PLACEHOLDER__`, `__VIP_PUBLIC_BASE_URL_PLACEHOLDER__`,
  `__VIP_CAMPAIGN_CODE_PLACEHOLDER__`) con cache en memoria por proceso.
- **Comunidad de Telegram (link del canal):** se configura en panel → Comandos →
  card "📣 Comunidad / Canal de Telegram" (`communityConfig.channelUrl`; lectura
  `GET /api/config/community` + redirect `GET /go/comunidad`). En el front lo aplica
  `chat.js._applyCanalUrl` a TRES lugares: pill del header + ítem del menú ☰ (dashboard
  viejo, tapado por el casino) y, desde #270, la fila **"📣 Unite a la Comunidad"**
  del widget "Cargas Automáticas" (`#casinoCommunityRow`, ui.js
  `_applyCasinoCommunity`): SIEMPRE visible, href estático `/go/comunidad` que chat.js
  pisa con el link directo cuando la config llega (`VIP.state.communityChannelUrl`).
- **Flags de acceso (#322):** `VIP.flags {sms, signup}` (config.js) = interruptores del
  panel, default apagado. Un inline del `<head>` aplica lo cacheado (`localStorage
  vip_access_flags`) como clases `html.sms-off` / `html.signup-off` antes del primer frame;
  `VIP.loadAccessFlags()` lo refresca contra `GET /api/config/access`. Con `signup` apagado
  no hay "Registrarse" / tab "Crear cuenta" ni popup de referidos; con `sms` apagado no hay
  recuperar clave, verificar teléfono ni teléfono en el cambio de clave.
- **Botón CASINO** (`#plataformaBtn` → `VIP.ui.enterCasino()`): login único contra
  1girox. Ver la trampa del pop-up blocker en §4.9. El modal de acceso manual sigue
  existiendo, pero **sólo como camino de respaldo** cuando el SSO falla.
- Duplicados front/back a mantener sincronizados: mínimo retiro $4.999, bono $5.000,
  `VIP.config.PLATFORM_URL` = `https://1girox.com` (respaldo del SSO; también aparece
  hardcodeada en los mensajes `/sys_deposit*`, `/sys_bonus` y `/sys_welcome` sembrados
  en `initializeData()`), defaults de % de reembolso.
- **Perfil del jugador** (recuadro USUARIO → `VIP.refunds.showProfileModal`): nivel
  VIP con barra de progreso + botón de rakeback semanal + reembolsos por período
  (solo %) + escalera completa (viene de `GET /api/vip/status`, no se duplica). El
  rótulo del recuadro muestra la medalla del nivel (`updateDashVipBadge`).

### Panel admin (`public/adminprivado2026/`)
- `admin.js` (~14k líneas), auth mixta: login → Bearer en memoria + cookies httpOnly;
  `checkAdminSession()` (`GET /api/admin/me`) restaura sesión al recargar.
- Roles: admin ve todo; depositor (abiertos/cerrados); withdrawer (solo Pagos);
  comunidad (abiertos/cerrados/comunidad); **publisher_admin tiene vista propia**
  (`#publisherAdminSection`, early-return en setupRoleBasedUI, funciones `pa*`).
- Chat: `renderConversations` con coalescing rAF + delegación de eventos (#91);
  `selectConversation` → `loadUserInfo` → banners (bloqueo, fraude/multicuenta,
  fueguito 30%, tags/notas, payout pendiente con botones pay/other-bank/cancel/
  dismiss/sync, promo bonus). Races protegidas por `activeConversationId` +
  AbortController — **no romper ese patrón**. La cabecera muestra el nivel VIP del
  cliente (`user.vipLevelInfo`, resuelto por el backend) y la tabla de Usuarios la
  medalla junto al nombre.
- **Nombres legacy en la API de campañas** (deuda a propósito para no romper el panel):
  el body sigue mandando `jugayganaPassword` y el endpoint se llama
  `POST /api/admin/campaigns/:code/test-jugaygana-creds`, pero adentro se guarda y se
  prueba `giroxApiKey` (el panel valida que empiece con `pk_`). La respuesta del listado
  expone `hasJugayganaCreds` mapeado desde `hasGiroxKey`. El "probar login" ya no
  loguea: consulta un jugador inexistente — 404 = key válida, 401 = key rechazada.
- `public/admin-sw.js` (scope /adminprivado2026/, servido por un handler propio; versión
  actual en su `CACHE_VERSION`): network-first no-store para el shell.
- **Card "📵 SMS y registro"** (Configuración, solo admin general, #322): interruptores de
  §3. Con el SMS apagado el ítem "SMS Masivo" del menú se oculta.
- Servido por handlers propios con cache en memoria (`readFileCached`) + ADMIN_HOST
  check opcional; el catch-all bloquea todo otro path bajo /adminprivado2026/.
- Secciones "Automatización" y "Estrategia de bonos" están marcadas "No se usa" en el
  sidebar pero siguen funcionales (candidatas a limpieza con el owner).
- La sección "Base de Datos" fue ELIMINADA por completo (2026-07-09): era inalcanzable.

## 7. Motores automáticos / crons (todos `setInterval` en server.js — corren en CADA instancia)

| Motor | Frecuencia | Estado | Idempotencia |
|---|---|---|---|
| `_runNotifRulesEvaluator` (reglas push) | 5 min | activo (reglas refund/tier inertes: PlayerStats no portado) | lastFiredAt + ventana |
| `_runEncuestaTick` | 5 min | pushes sí, **bonos apagados** (`bDays=[]`) | EncuestaFire.slotKey único |
| `_runInactividadTick` | 6 h | **APAGADO** (`INACTIVIDAD_DISABLED=true`) | InactividadFire.fireKey único |
| `_runBonusStrategy` | 10 min | **APAGADO** (`BONUS_STRATEGY_DISABLED=true`) | step en StrategyEnrollment |
| `_runDueSchedules` (ScheduledNotif) | 60 s | activo | lastRunAt |
| `_pollPayingPayouts` | 45 s | activo (confirma pagos si el webhook no llegó) | handlePayoutStatusWebhook idempotente |
| `_runStaleComprobanteSweep` | 60 s | activo (comprobante sin carga a los `HGCASH_STALE_MIN` min → chat a Abiertos) | claim atómico `Comprobante.staleAlertedAt` + sólo post-boot |
| `_runVipTick` (niveles VIP) | 30 min | activo (se apaga desde el panel: Config → "Niveles VIP", flag `vip_levels_disabled` en Config, SOLO admin general — sin cache a propósito para que aplique al instante en todas las instancias) | buckets con `$set` idempotente + bono con reference `vip-lvl-*` (la plataforma dedupe) |
| `_runVipSweepCheck` (sweep VIP) | 1 h (corre a las 05 ART) | activo | claim atómico por día en Config (`vip_sweep_day`) → instancia única |
| `_runFcmPrune` | 24 h | activo | flag anti-overlap en memoria |
| `fbAdsWebhook.startWorker` | 5 min | activo | nextRetryAt |
| Limpieza mensajes >3d | 6 h | activo (red de seguridad del TTL) | deleteMany |
| `_processNotifBatchQueue` (lotes con regalo) | 45 s + kick al crear | activo | claim atómico por destinatario (`delivery:null → 'sending'`), reference `vip-nbatch-*` |
| `_expireDailyRoulettePct` | 15 min (+ lazy en claim/status) | activo — vence el % EXTRA de la ruleta diaria a las 24 h (#305) | update condicional, idempotente |
| `_runMonthlyReferralPayout` | 1 h (+5 min tras el arranque) | activo — paga referidos del mes anterior el día 1 (#307) | Config `referral_autorun_<YYYY-MM>` con `$setOnInsert` → una sola instancia; servicio incremental |

Migraciones one-shot: patrón flag en Config (`migration_*_done`) en `initializeData()`.
El backfill de `usernameLower` corre en CADA arranque (idempotente) y setea
`_usernameLowerReady`.

## 8. Convenciones importantes

- **Mensajes automáticos al usuario** → `renderSystemCommand(name, fallback, vars, opts)` y
  sembrar el comando en `systemCmds` de `initializeData()`. Respuesta VACÍA en el panel
  = "no enviar" (null). Variables: montos como `${amount}` en el template y se
  reemplaza `{amount}` (el `$` queda como signo); texto como `{username}` sin `$`.
  Variables globales (#281): `{rollover}` / `{rollover_txt}` (rollover efectivo del
  panel); con `opts.bonus:true` la frase se agrega sola si el comando no la tiene
  (`{rollover_off}` la evita). `applyRolloverVars()` para los mensajes armados a mano.
- **Copy de referidos al cliente** (#314): hablar de "comisión del X% por la actividad
  de tus referidos", NUNCA "de lo que pierdan" / "pérdida neta" (decisión del owner:
  queda chocante; el paquete del gemelo lo decía y se adaptó en #317). El % en JS sale de
  `VIP.ui._rwRefPct()` / `_rwRefPctTxt()` ("hasta el X%" con niveles) o del dashboard; en
  HTML estático NO poner número (se desactualiza).
- **Identidad**: `user.id` (uuid), no `_id`. Username case-insensitive →
  `findUserByUsernameCI` (indexado + fallback), NUNCA regex nuevo.
- **periodKey**: `YYYY-MM` (referidos y VipWagerMonth); RefundClaim usa
  `weekly:YYYY-MM-DD` / `monthly:YYYY-MM` / `rake:YYYY-MM-DD` (lunes de la
  semana del rakeback VIP) / `daily:YYYY-MM-DD` (día reembolsado — el diario se
  eliminó el 2026-08-07 y volvió el 2026-09-24, #297).
- **Montos 1girox: PESOS.** Se envían tal cual (2 decimales), y los balances y el netwin
  del panel vuelven en pesos. **NO multiplicar ni dividir por 100** — el ×100 de
  centavos era de JUGAYGANA y ya no existe.
- **Toda operación de plata lleva `reference`** estable y persistida (§4.4). Reintento
  ⇒ MISMA reference. Chequear `result.duplicate` antes de dar un pago por bueno.
- **Todo lo fire-and-forget** (tracking, comprobantes, fanout, SLA) va en try/catch y
  JAMÁS frena la respuesta al cliente — mantener ese patrón.
- **Crédito de plata al cliente = RESERVAR ATÓMICO ANTES de acreditar** (nunca acreditar
  y limpiar el flag después → TOCTOU/doble cobro). Patrón: `findOneAndUpdate` con guard
  del flag (ruleta, bono instalación, fueguito claim-reward) o `create` con índice único
  (reembolsos). Si el crédito falla, revertir la reserva. Ver #96.
- **Endpoints muertos**: se eliminan con comentario-lápida y rollback `git revert`.
- **Validación local**: sólo `node --check` (no hay node_modules en Tails).

## 9. Trampas / "no rompas esto"

- **SMS y registro APAGADOS por default (#322)**: interruptores `Config['accessSwitches']`
  (§3). No "arreglar" un 403 `REGISTRATION_DISABLED` / 503 `SMS_DISABLED` en el código: se
  prende desde el panel. En el front, todo lo que dependa de SMS o registro pregunta
  `VIP.flags.sms` / `VIP.flags.signup` (`=== true`) y se oculta por las clases
  `html.sms-off` / `html.signup-off` (CSS en el `<head>` de index.html); `VIP.ui.showModal`
  bloquea los modales de registro/SMS. El default apagado aplica a CUALQUIER entorno cuya
  base no tenga el Config guardado.
- **Entorno nuevo / clonado en EB (#323)**: (a) el server escucha recién DESPUÉS de SSM →
  Mongo → Redis; si el Redis no es alcanzable (grupo de seguridad sin la regla 6379 para las
  instancias nuevas) `setupRedisAdapter` reintenta para siempre y todo da 502 sin crashear.
  (b) `ALLOWED_ORIGINS` se compara EXACTO contra el header `Origin`: minúsculas, con
  `https://`, sin barra final; si no coincide, hasta el login del propio panel da 500. El warn
  "ALLOWED_ORIGINS no configurado" del arranque es falsa alarma cuando viene de SSM (se
  evalúa antes de cargar SSM). (c) Lo que está en SSM pisa las propiedades del entorno salvo
  `SSM_SKIP_KEYS`; dos entornos con el mismo `SSM_PATH` comparten todo lo que no se saltee.
- **DOS `connectDB`**: el real es `config/database.js`; el de `src/models/index.js` NO
  se usa. No definir schemas en config/database.js.
- **Referidos (#317)**: DOS funciones con nombre parecido — `referralTierService.
  resolveReferralRate(user)` (la que PAGA: override > niveles > plano) y
  `utils/referralRate.resolveReferralRate()` (= `refreshReferralRateFromCommand`, solo relee
  el % plano del comando). Para plata o copy, SIEMPRE la del servicio de niveles. El
  `/api/referrals/dashboard` consulta 1girox por referido con cargas (cache 15 min, tope 60):
  no llamarlo en el arranque del cliente en modo casino (solo el popup 1× cada 24 h / el
  modal). `/api/referrals/admin/activity` NO consulta 1girox. Nada de premios en plata por
  cantidad de referidos.
- **Secrets por SSM**: no leer `process.env.X` al require; lazy getters. Los módulos
  `girox*` ya siguen ese patrón (getters + cliente HTTP on-demand); los 4 clientes
  viejos congelaban `process.env` en consts de módulo — no copiar ese patrón.
- **Código muerto de JUGAYGANA**: `jugaygana.js`, `jugaygana-movements.js`,
  `jugayganaService.js`, `jugayganaPublisherSessions.js`, `referralRevenueService.js` y
  `jugayganaUserLinkService.js` siguen en el repo pero **nadie los importa** (sólo se
  importan entre ellos y desde `scripts/_archive/`). Están para revertir. No agregarles
  llamadas nuevas ni "arreglarlos".
- **Montos en PESOS** — el ×100 murió con JUGAYGANA (§8).
- **`reference` = plata** (§4.4): repetida entre operaciones distintas ⇒ la segunda NO
  se acredita (vuelve `duplicate:true`); cambiada entre reintentos del mismo pago ⇒ se
  paga dos veces. La del reembolso sale del **periodKey**, no del RefundClaim.id (si
  saliera del id, el reintento tras un fallo falso pagaría doble).
- **Retiros: validar contra `available`, no `balance`** — el rollover está activo en
  1girox y parte del saldo puede estar bloqueado (§4.5).
- **Regalos = `creditGift` (bono), NUNCA `depositToUser`** (#266, §4.5). El fallback a
  depósito+multiplier lo decide `creditGift` solo (bono activo / feat apagado). Flujos
  que NO son bono (comisiones, devoluciones de retiro) → `ignoreGlobalRollover:true`.
- **Rate limit 60/min es POR INSTANCIA** (`GIROX_MAX_RPM`, default 55): con N instancias
  el techo real es N×55. Si aparecen 429, BAJAR el valor (§4.3).
- **El netwin sale de la Partner API** (`getPlayerStats` / batch, por username, §4.6) y
  es **sólo casino** (`GIROX_NETWIN_SCOPE`). `giroxUserId` ya no bloquea nada.
  ⚠️ `netwin` POSITIVO = el jugador PERDIÓ.
- **Message TTL 3 días; Transaction permanente.** Snapshot en ChatDelay por eso.
- **ChatStatus se crea con actividad**, no al crear el usuario.
- **Atribución de publicista** se fija al registrar; el login NO la cambia. El referido
  (`?ref=`) tiene prioridad sobre publicista en el front.
- **publisher_admin**: endpoint nuevo para ese rol ⇒ sumarlo a
  `PUBLISHER_ADMIN_ALLOWED_PATHS`.
- **`adminMiddleware` deja pasar 4 roles** — todo endpoint sensible re-chequea
  `role==='admin'` explícito (patrón #80; los CRÍTICOS ya están cerrados).
- **Tope 30% en bonos automáticos** (owner 2026-07-08): cap de lectura en
  `_getActivePromoBonus`, validaciones ≤30 en configs, plantillas bono_50/100
  eliminadas + guard en `_runStrategyLaunch`. Los botones manuales +50/+100 del modal
  de depósito QUEDAN (herramienta del agente).
- **Multi-instancia**: crons corren en cada instancia — la idempotencia vive en los
  índices únicos (slotKey, fireKey, chargeKey, userId+dateKey) — ahora reforzada por la
  `reference` de 1girox del otro lado. No dropearlos. La blacklist JWT de
  src/middlewares/auth.js, `generalLimiter` y el limitador de RPM de `giroxService` son
  por-instancia.
- **USERS_LIST_FIELDS** (`GET /api/admin/users`) y la proyección de
  `AUTH_USER_FIELDS` (authMiddleware): campo nuevo consumido ⇒ sumarlo al select.
- **onclick inline** en panel y PWA dependen de `window.*` — no renombrar exports sin
  actualizar los strings. En `renderUsers` las comillas SIMPLES del onclick con JSON
  son a propósito.
- **CACHE de assets por proceso** (`readFileCached`, `_indexHtmlBase`,
  `_adminHtmlRendered`): index.html/admin.js/css se leen 1 vez por proceso — cambios
  llegan con el redeploy (que reinicia). No agregar contenido dinámico por-request al
  HTML sin pasar por `renderIndexHtml`.
- **Firebase config duplicada** (index.html + firebase-messaging-sw.js) y VAPID key en
  el inline: cambiar en ambos lados.
- **`Campaign.hasGiroxKey` es un espejo** de `giroxApiKey` (que es `select:false`):
  cualquier camino que escriba o limpie la key TIENE que actualizar el booleano, o el
  panel muestra el badge equivocado.
- **Trampa del pop-up blocker en el botón CASINO**: la pestaña se abre ANTES del fetch,
  dentro del gesto del usuario. Mover el `window.open` después del `await` rompe el SSO
  en mobile (§4.9).
- **`GET /api/movements` quedó sin backend**: la Partner API no expone historial de
  apuestas/movimientos, así que `girox.getUserMovements()` devuelve siempre
  `not_supported` (explícito a propósito, para fallar claro en vez de con un TypeError).
  El endpoint responde 400. Si alguien lo necesita, hay que pedirlo a 1girox o sacarlo.
- **`_communityRecommendCard` (roulette.js)**: feature pedida por el owner que nunca
  se conectó — lee `VIP.state.communityLink*` que nadie setea (el wiring real de
  comunidad es `loadCommunity()` inline → `/api/config/community`). Es MEJORA
  PENDIENTE (reconectar seteando VIP.state desde loadCommunity), no código muerto.
- **`checkUsernameAvailability` (PWA)**: existe pero no se dispara — mejora pendiente.
- **vercel.json es un artefacto** de un deploy anterior; el deploy real es AWS EB.
- **Env DB_PASSWORD ya no se usa** (sección Base de Datos eliminada 2026-07-09).
