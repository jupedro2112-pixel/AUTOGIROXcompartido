// ========================================
// UI - User-interface utilities module
// ========================================

window.VIP = window.VIP || {};

VIP.ui = (function () {

    // ---- Modal helpers ----

    // #322: modales que no se abren con el registro cerrado / el SMS apagado
    // (interruptores del panel, VIP.flags). Cubre TODOS los caminos que los
    // abren (botones, link ?ref=, onclick inline) sin tocar cada uno.
    const SMS_ONLY_MODALS = ['resetPassModal', 'verifyPhoneModal', 'smsOfferModal'];

    function showModal(modalId) {
        const flags = VIP.flags || {};
        if (modalId === 'registerModal' && flags.signup !== true) {
            showToast('El registro de cuentas nuevas no está disponible por el momento.', 'info');
            return;
        }
        if (SMS_ONLY_MODALS.includes(modalId) && flags.sms !== true) {
            if (modalId !== 'smsOfferModal') showToast('La verificación por SMS no está disponible por el momento. Escribinos a soporte y te ayudamos.', 'info');
            return;
        }
        document.getElementById(modalId).classList.remove('hidden');
    }

    // #289 (owner 2026-09-24): tocar AFUERA del recuadro cierra el modal (registro,
    // recuperar clave, reseñas, regalos…). Excepciones: el cambio de clave
    // obligatorio y la bienvenida del publicista (tienen su propio flujo).
    const MODALS_NO_BACKDROP_CLOSE = ['changePasswordModal', 'publisherWelcomeModal'];
    document.addEventListener('click', function (e) {
        const m = e.target && e.target.classList && e.target.classList.contains('modal') ? e.target : null;
        if (!m || !m.id || MODALS_NO_BACKDROP_CLOSE.includes(m.id)) return;
        try { hideModal(m.id); } catch (err) {}
    });

    function hideModal(modalId) {
        if (modalId === 'changePasswordModal' && VIP.state.passwordChangePending) {
            return;
        }
        document.getElementById(modalId).classList.add('hidden');

        // Reset OTP step states when closing modals
        if (modalId === 'resetPassModal') {
            const s1 = document.getElementById('resetStep1');
            const s2 = document.getElementById('resetStep2');
            const s3 = document.getElementById('resetStep3');
            if (s1) s1.style.display = '';
            if (s2) s2.style.display = 'none';
            if (s3) s3.style.display = 'none';
        }
        if (modalId === 'registerModal') {
            const s1 = document.getElementById('registerStep1');
            if (s1) s1.style.display = '';
        }
    }

    // ---- Toast & copy ----

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast('✅ Copiado');
        } catch (error) {
            showToast('Error al copiar', 'error');
        }
    }

    function copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        const text = element.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('📋 Copiado al portapapeles', 'success');
            }).catch(() => { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity  = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        try { document.execCommand('copy'); showToast('✅ Copiado', 'success'); } catch (e) {}
        document.body.removeChild(el);
    }

    // ---- Screen switching ----

    function showLoginScreen() {
        document.getElementById('chatScreen').classList.add('hidden');
        // #288: sin sesión se muestra el CASINO en modo invitado (sitio público
        // de fondo + widget con Ingresar/Registrarse). La pantalla vieja de
        // login queda solo como fallback si el modo invitado no pudo abrir.
        try { if (VIP.ui.enterCasinoGuest && VIP.ui.enterCasinoGuest()) return; } catch (e) {}
        // Sacar el splash de arranque (#253): acá SÍ hay que ver el login.
        try { document.documentElement.classList.remove('casino-boot'); } catch (e) {}
        document.getElementById('loginScreen').classList.remove('hidden');
    }

    function showChatScreen() {
        try { if (VIP.ui._guestExit) VIP.ui._guestExit(); } catch (e) {} // #288
        // Splash de arranque (#253): para roles que NO van al casino se saca ya;
        // para clientes, lo saca _showCasinoFrame al abrir el casino. Red de
        // seguridad: si a los 4s el casino no abrió (modal de cambio de clave,
        // error de SSO, etc.), se saca igual para no dejar la pantalla tapada.
        try {
            const _role = VIP.state.currentUser && VIP.state.currentUser.role;
            if (_role && _role !== 'user') document.documentElement.classList.remove('casino-boot');
            else setTimeout(function () {
                try { if (!VIP.ui._casinoOpen) document.documentElement.classList.remove('casino-boot'); } catch (e) {}
            }, 4000);
        } catch (e) {}
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('chatScreen').classList.remove('hidden');
        const _username = VIP.state.currentUser?.username || 'Usuario';
        const _curUser = document.getElementById('currentUser');
        if (_curUser) _curUser.textContent = _username;
        const _dashUser = document.getElementById('dashUserName');
        if (_dashUser) _dashUser.textContent = _username;

        adjustLayout();
        syncBalance();
        startBalancePolling();
        sendWelcomeMessages();

        // Cartel del bono por instalar la app (se muestra si no lo reclamó aún).
        if (VIP.installBonus && typeof VIP.installBonus.init === 'function') {
            VIP.installBonus.init();
        }

        // Encuesta de notificaciones: aparece una sola vez para que el
        // usuario elija su grupo (suave / normal / activo / solo reembolsos).
        if (VIP.notifSurvey && typeof VIP.notifSurvey.maybeShow === 'function') {
            VIP.notifSurvey.maybeShow();
        }
        // NOTA: el welcome del publicista NO se muestra acá. Se muestra
        // pre-auth desde app.js al cargar la página si el visitante llegó
        // por una vanity URL / ?p=CODE. Ver public/js/publisherwelcome.js.
    }

    // ---- Layout ----

    function adjustLayout() {
        // El layout ahora es una columna flex (.chat-screen): el header y la
        // barra de escribir están en el flujo normal y el chat ocupa el resto
        // con flex:1. No hace falta compensar con márgenes.
    }

    // ---- Balance ----

    async function syncBalance() {
        if (!VIP.state.currentToken || !VIP.state.currentUser) return;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/balance/live`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.balance !== undefined) {
                    VIP.state.currentUser.balance = data.balance;
                    updateBalanceDisplay(data.balance);

                    const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
                    const newBalance      = parseFloat(data.balance);
                    if (Math.abs(newBalance - previousBalance) > 0.01) {
                        localStorage.setItem('lastBalance', newBalance);
                        if (newBalance > previousBalance) {
                            // Subió el saldo (carga/premio): invitación grande al
                            // casino en vez del toast chico (owner 2026-08-05).
                            showCasinoInvite(newBalance);
                        } else {
                            showBalanceToast(newBalance);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sincronizando saldo:', error);
        }
    }

    // Saldo empujado por SOCKET (el server emite `balance_updated` al acreditar
    // una carga, premio o devolución): mismo tratamiento que el polling, pero
    // instantáneo — el cliente ve la invitación al casino apenas el agente carga.
    function handleBalancePush(balance, info) {
        const newBalance = parseFloat(balance);
        if (!Number.isFinite(newBalance)) return;
        if (VIP.state.currentUser) VIP.state.currentUser.balance = newBalance;
        updateBalanceDisplay(newBalance);
        const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
        if (Math.abs(newBalance - previousBalance) > 0.01) {
            localStorage.setItem('lastBalance', newBalance);
            if (newBalance > previousBalance) {
                // CARTEL GRANDE + sonido SIEMPRE que se acredite (auto o manual
                // del admin) — el cliente se da cuenta (owner 2026-08-21). El
                // cartel de invitación viejo solo si NO está en el casino.
                if (VIP.ui.casinoBotDepositConfirmed) {
                    try { VIP.ui.casinoBotDepositConfirmed(newBalance, info); } catch (e) {}
                } else {
                    showCasinoInvite(newBalance);
                }
            } else {
                showBalanceToast(newBalance);
            }
        }
    }

    // ---- Invitación al casino tras una carga (owner 2026-08-05) ----
    // Cuando el saldo SUBE, un recuadro grande y bien visible invita a entrar al
    // casino YA LOGUEADO (VIP.ui.enterCasino, el SSO de siempre). Se va solo a
    // los 15 segundos (barra de tiempo incluida) o con la ✕. Throttle de 60s:
    // el evento puede llegar por socket Y por el polling de saldo — una sola vez.
    let _lastCasinoInviteAt = 0;
    let _casinoInviteTimer = null;

    function showCasinoInvite(balance) {
        const now = Date.now();
        if (now - _lastCasinoInviteAt < 60000) return;
        if (!VIP.state.currentUser) return;
        if (VIP.ui._casinoOpen) return; // ya está jugando: no tapar el casino
        _lastCasinoInviteAt = now;

        let box = document.getElementById('casinoInviteBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'casinoInviteBox';
            box.style.cssText =
                'position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:19000;' +
                'width:min(92vw,380px);background:linear-gradient(150deg,#1a0033,#2d0052);' +
                'border:2px solid #ffd700;border-radius:18px;padding:18px 16px 14px;text-align:center;' +
                'box-shadow:0 12px 44px rgba(212,175,55,0.6);display:none;';
            document.body.appendChild(box);
        }
        const amt = Number(balance) || 0;
        box.innerHTML =
            '<button type="button" onclick="VIP.ui.hideCasinoInvite()" ' +
                'style="position:absolute;top:6px;right:10px;background:none;border:none;color:#999;font-size:20px;cursor:pointer;line-height:1;">×</button>' +
            '<div style="font-size:30px;line-height:1;margin-bottom:6px;">💰</div>' +
            '<div style="color:#00ff88;font-weight:900;font-size:16px;margin-bottom:2px;">¡Saldo acreditado!</div>' +
            '<div style="color:#fff;font-weight:800;font-size:22px;margin-bottom:10px;">$' + amt.toLocaleString('es-AR') + '</div>' +
            '<button type="button" onclick="VIP.ui.hideCasinoInvite();VIP.ui.enterCasino();" ' +
                'style="width:100%;background:linear-gradient(135deg,#d4af37,#ffd700);color:#000;border:none;' +
                'padding:14px;border-radius:26px;font-weight:900;font-size:16px;cursor:pointer;' +
                'box-shadow:0 4px 16px rgba(212,175,55,0.5);">🎰 JUGAR AHORA EN 1GIROX</button>' +
            '<div style="color:#aaa;font-size:10.5px;margin-top:7px;">Entrás directo, con tu sesión ya iniciada</div>' +
            // 🪦 Acá iba el cartel informativo del código de $5.000: reemplazado
            // (owner 2026-08-05) por la mini-ENCUESTA de Comunidad de abajo.
            (localStorage.getItem('communitySurveyDone') === '1' ? '' :
            '<div id="casinoInviteSurvey" style="margin-top:9px;padding:9px 10px;background:rgba(41,169,235,0.10);border:1px solid rgba(41,169,235,0.45);border-radius:10px;">' +
                '<div style="color:#9ad8f7;font-size:11.5px;font-weight:800;">📣 ¿Ya estás en nuestra Comunidad de Telegram?</div>' +
                '<div style="color:#8fb9cc;font-size:10px;margin-top:2px;">Bonos, códigos gratis y avisos exclusivos.</div>' +
                '<div style="display:flex;gap:8px;margin-top:8px;">' +
                    '<button type="button" onclick="VIP.ui.casinoInviteJoinCommunity()" ' +
                        'style="flex:1;background:linear-gradient(135deg,#29a9eb,#53bdeb);color:#fff;border:none;padding:9px 6px;border-radius:18px;font-weight:900;font-size:12px;cursor:pointer;">🚀 SÍ, quiero entrar</button>' +
                    '<button type="button" onclick="VIP.ui.casinoInviteAlreadyIn()" ' +
                        'style="flex:1;background:rgba(255,255,255,0.10);color:#cde;border:1px solid rgba(255,255,255,0.25);padding:9px 6px;border-radius:18px;font-weight:800;font-size:12px;cursor:pointer;">✅ Ya estoy en la Comunidad</button>' +
                '</div>' +
            '</div>') +
            '<div style="height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin-top:9px;overflow:hidden;">' +
                '<div id="casinoInviteBar" style="height:100%;width:100%;background:#ffd700;transition:width 15s linear;"></div></div>';
        box.style.display = 'block';

        // Barra de tiempo: 100% → 0 en los 15s de vida del recuadro.
        requestAnimationFrame(function () {
            const bar = document.getElementById('casinoInviteBar');
            if (bar) requestAnimationFrame(function () { bar.style.width = '0%'; });
        });
        clearTimeout(_casinoInviteTimer);
        _casinoInviteTimer = setTimeout(hideCasinoInvite, 15000);
    }

    function hideCasinoInvite() {
        clearTimeout(_casinoInviteTimer);
        const box = document.getElementById('casinoInviteBox');
        if (box) box.style.display = 'none';
    }

    // ---- Mini-encuesta de Comunidad dentro de la invitación al casino ----
    // "SÍ, quiero entrar" → abre la Comunidad de Telegram (el link que se carga
    // en el panel → sección Comandos → card Comunidad; chat.js lo mantiene
    // aplicado en el pill del header, con fallback al dominio propio).
    // Cualquiera de las dos respuestas queda recordada: la encuesta no se
    // repite en próximas cargas (localStorage), el resto del cartel sigue igual.
    function casinoInviteJoinCommunity() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const pill = document.getElementById('canalTelegramHeaderBtn');
        // Fallback /go/comunidad: el server redirige al link vigente de la config
        // (owner 2026-08-06 — nunca más el 404 de canal-proximamente).
        const url = (pill && pill.href) || '/go/comunidad';
        window.open(url, '_blank', 'noopener');
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
    }

    function casinoInviteAlreadyIn() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
        showToast('¡Genial! 🙌 Gracias por estar en la Comunidad', 'success');
    }

    function showBalanceToast(balance) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
            color: #000;
            padding: 15px 25px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 16px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            box-shadow: 0 5px 20px rgba(0, 255, 136, 0.4);
        `;
        toast.innerHTML = `💰 Saldo actualizado: <span style="font-size: 20px;">$${balance.toLocaleString()}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateBalanceDisplay(balance) {
        const balanceElement = document.getElementById('userBalance');
        if (balanceElement) {
            balanceElement.textContent = `$${balance.toLocaleString()}`;
        }
    }

    function startBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
        }
        // 90s (antes 30s): el poll de saldo por-usuario era la causa raíz del lag
        // — para jugadores de un publicista TODAS las lecturas van por una única
        // key (30/min) y con pocos usuarios online se saturaba (logs 2026-08-16).
        // El saldo igual se actualiza al instante por socket (`balance_updated`)
        // en cargas/retiros/bonos, y al cerrar el casino (syncBalance). El poll
        // solo cubre cambios por juego mientras el cliente mira la PWA sin jugar.
        VIP.state.balanceCheckInterval = setInterval(syncBalance, 90000);
    }

    function stopBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
            VIP.state.balanceCheckInterval = null;
        }
    }

    // ---- Welcome message ----

    async function sendWelcomeMessages() {
        const welcomeKey  = 'lastWelcome_' + (VIP.state.currentUser?.userId || '');
        const lastWelcome = parseInt(localStorage.getItem(welcomeKey) || '0');
        const hoursSince  = (Date.now() - lastWelcome) / 3600000;
        if (hoursSince < 24) {
            return;
        }

        // La bienvenida ahora la genera el BACKEND como mensaje de sistema
        // (lado admin), no el cliente. Antes se mandaba con el token del
        // usuario vía sendSystemMessage → quedaba registrada con
        // senderRole='user' y aparecía como si la hubiera escrito el propio
        // usuario. El endpoint /api/messages/welcome la crea con
        // senderRole='admin' y tiene su propio throttle de 24h server-side.
        //
        // CON REINTENTOS (fix 2026-08-05): antes un fallo de red se tragaba en
        // silencio y sin retry → el cliente entraba (típico: por link de acceso
        // en una red lenta/Tor) con el chat VACÍO, y como la bienvenida es la
        // que crea el ChatStatus, el chat tampoco aparecía del lado del admin
        // hasta que el cliente escribiera o recargara la página.
        const delays = [0, 2500, 7000]; // 3 intentos
        for (let i = 0; i < delays.length; i++) {
            if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
            try {
                const response = await fetch(`${VIP.config.API_URL}/api/messages/welcome`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${VIP.state.currentToken}`
                    }
                });
                if (response.ok) {
                    // Refrescar el chat para mostrar los mensajes recién creados.
                    setTimeout(() => { try { VIP.chat.loadMessages(); } catch (e) {} }, 300);
                    localStorage.setItem(welcomeKey, Date.now().toString());
                    return;
                }
                // 4xx (ej. 401 por sesión a medio armar): reintentar igual — el
                // endpoint es idempotente (throttle server-side de 24h).
            } catch (error) {
                // red caída/lenta: probamos de nuevo con el próximo delay
            }
        }
        console.warn('[welcome] no se pudo enviar la bienvenida tras 3 intentos (se reintenta en la próxima carga)');
    }

    // ---- CBU ----

    async function loadAndShowCBU() {
        const now = Date.now();
        if (now - VIP.state.lastCbuClickTime < VIP.config.CBU_CLICK_COOLDOWN_MS) {
            showToast('Espera unos segundos antes de volver a solicitar el CBU.', 'info');
            return;
        }
        VIP.state.lastCbuClickTime = now;

        try {
            const metaEventId = VIP.pixel && VIP.pixel.enabled ? VIP.pixel.newEventId() : null;
            const response = await fetch(`${VIP.config.API_URL}/api/cbu/request`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ metaEventId })
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('cbuBankDisplay').textContent    = data.cbu.bank    || '-';
                document.getElementById('cbuTitularDisplay').textContent = data.cbu.titular || '-';
                document.getElementById('cbuNumberDisplay').textContent  = data.cbu.number  || '-';
                document.getElementById('cbuAliasDisplay').textContent   = data.cbu.alias   || '-';

                showModal('cbuModal');
                setTimeout(() => VIP.chat.loadMessages(), 500);
                showToast('💳 Datos CBU enviados al chat', 'success');

                // Meta Pixel — InitiateCheckout (usuario va a depositar).
                if (VIP.pixel) VIP.pixel.trackWithId(metaEventId, 'InitiateCheckout', { content_name: 'cbu_request' });
            } else {
                showToast('Error solicitando CBU', 'error');
            }
        } catch (error) {
            console.error('Error solicitando CBU:', error);
            showToast('Error de conexión', 'error');
        }
    }

    // ---- Referrals (#317, réplica #168-#175 del gemelo, adaptada a 1girox) ----
    // Copys: regla #314 del owner → hablar de "comisión por la ACTIVIDAD de tus referidos",
    // nunca "lo que pierdan" (queda chocante). El número que se muestra es el netwin del mes.
    const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let _refData = null;
    let _refLoadedAt = 0;
    const _refMoney = (n) => '$' + new Intl.NumberFormat('es-AR').format(Math.round(Number(n) || 0));
    function _refPct(rate) { return _refPctNum(_refPctOf(rate)); }
    function _refPctOf(rate) { const n = Number(rate); return Math.round((Number.isFinite(n) ? n : 0) * 10000) / 100; }
    function _refPctNum(p) { const n = Number(p) || 0; return (Number.isInteger(n) ? n : n.toFixed(n * 10 % 1 ? 2 : 1)) + '%'; }
    function _refMaxPct(d) { const lv = (d && d.level) || {}; return _refPctNum(lv.maxPct != null ? lv.maxPct : _refPctOf(d && d.rate)); }
    function _refAgo(d) {
        if (!d) return '';
        const ms = Date.now() - new Date(d).getTime();
        const dias = Math.floor(ms / 86400000);
        if (dias <= 0) return 'hoy';
        if (dias === 1) return 'hace 1 día';
        if (dias < 30) return 'hace ' + dias + ' días';
        const m = Math.floor(dias / 30);
        return m === 1 ? 'hace 1 mes' : 'hace ' + m + ' meses';
    }

    async function fetchReferralDashboard(force) {
        if (!force && _refData && Date.now() - _refLoadedAt < 60000) return _refData;
        const r = await fetch(`${VIP.config.API_URL}/api/referrals/dashboard`, { headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` } });
        if (!r.ok) throw new Error('dashboard ' + r.status);
        const d = await r.json();
        _refData = d; _refLoadedAt = Date.now();
        VIP.state.referralData = d;
        // #171 el cartel promocional muestra el MÁXIMO alcanzable ("hasta el 3%"); el % propio va en el tablero.
        const lv = d.level || {};
        document.querySelectorAll('.referralRatePct').forEach(el => { el.textContent = _refPctNum(lv.maxPct != null ? lv.maxPct : _refPctOf(d.rate)); });
        document.querySelectorAll('.referralMyPct').forEach(el => { el.textContent = _refPctNum(lv.pct != null ? lv.pct : _refPctOf(d.rate)); });
        return d;
    }

    async function openReferralModal() {
        showModal('referralModal');
        await loadReferralData(true);
    }

    async function loadReferralData(force) {
        const c = document.getElementById('referralContent');
        if (c && !_refData) c.innerHTML = '<span style="color:#888;font-size:12px;">Cargando tus referidos…</span>';
        try {
            const d = await fetchReferralDashboard(force);
            renderReferralModal(d);
            renderReferralHomeCard(d);
        } catch (err) {
            console.error('[Referrals] Error cargando datos:', err);
            if (c) c.innerHTML = '<span style="color:#ff4444;font-size:12px;">No se pudieron cargar tus datos de referidos. Reintentá.</span>';
        }
    }

    // #171 tile de un NIVEL de comisión (cantidad de referidos activos → %).
    function _refTierHtml(t, lv) {
        const on = t.reached, cur = t.current;
        let foot;
        if (cur) foot = '<span class="ref-pill" style="background:rgba(0,255,136,.15);color:#00ff88;border:1px solid rgba(0,255,136,.5);">⭐ Tu nivel actual</span>';
        else if (on) foot = '<span class="ref-pill" style="background:rgba(255,215,0,.12);color:#ffd700;border:1px solid rgba(255,215,0,.5);">✅ Alcanzado</span>';
        else foot = '<span class="ref-pill" style="background:rgba(255,255,255,.06);color:#999;border:1px solid rgba(255,255,255,.15);">🔒 Te faltan ' + Math.max(0, t.count - (lv.active || 0)) + '</span>';
        return '<div style="flex:1;min-width:96px;text-align:center;padding:9px 6px;border-radius:10px;background:' + (cur ? 'rgba(0,255,136,.07)' : (on ? 'rgba(255,215,0,.08)' : 'rgba(255,255,255,.03)')) + ';border:1px solid ' + (cur ? 'rgba(0,255,136,.55)' : (on ? 'rgba(255,215,0,.55)' : 'rgba(255,255,255,.12)')) + ';">' +
            '<div style="font-size:11px;font-weight:900;color:#fff;margin-top:2px;">' + t.count + ' ACTIVOS</div>' +
            '<div style="font-size:22px;font-weight:900;color:' + (on ? '#ffd700' : '#bbb') + ';line-height:1.15;">' + _refPctNum(t.pct) + '</div>' +
            '<div style="font-size:9.5px;color:#aaa;margin-bottom:6px;">de comisión</div>' + foot + '</div>';
    }

    function renderReferralModal(d) {
        const c = document.getElementById('referralContent');
        if (!c || !d) return;
        const t = d.totals || {}, lv = d.level || {}, per = d.period || {};
        const pct = _refPct(d.rate);
        const tiers = lv.tiers || [];
        const maxCount = lv.maxCount || (tiers.length ? tiers[tiers.length - 1].count : 10);
        const prog = Math.min(100, Math.round((lv.active || 0) / Math.max(1, maxCount) * 100));
        const tiersOn = lv.enabled !== false && lv.mode === 'tiers' && tiers.length;
        const netInfoId = 'refNetInfo';
        let html = '';
        // Link (solo el link: más directo que el código)
        html += '<div style="background:rgba(255,255,255,.05);border:1px solid #d4af37;border-radius:12px;padding:12px;margin-bottom:12px;">' +
            '<span style="color:#b0b0b0;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:5px;">Tu link de referido</span>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span id="myReferralLink" style="font-size:12px;color:#00ff88;word-break:break-all;flex:1;min-width:0;">' + _esc(d.referralLink || '—') + '</span>' +
            '<button onclick="VIP.ui.copyReferralLink()" style="background:rgba(0,255,136,.1);border:1px solid #00ff88;color:#00ff88;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">📋 Copiar</button>' +
            '</div>' +
            '<button onclick="VIP.ui.shareReferralLink()" style="width:100%;margin-top:9px;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;border-radius:10px;padding:10px;font-weight:900;font-size:13px;cursor:pointer;">🔗 INVITAR A TUS AMIGOS</button>' +
            '<div style="font-size:10px;color:#888;margin-top:6px;text-align:center;">Tu amigo entra por el link, se registra y queda vinculado a vos para siempre. Código: <b style="color:#d4af37;letter-spacing:1px;">' + _esc(d.referralCode || '') + '</b></div>' +
            '</div>';
        // Tiles
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
            '<div class="ref-modal-tile" style="border-color:rgba(0,255,136,.35);"><span class="v" style="color:#00ff88;">👥 ' + (tiersOn ? (lv.active || 0) : (t.active || 0)) + '</span><span class="l">Referidos activos<br><span style="color:#777;">(' + (tiersOn ? 'cargaron al menos ' + _refMoney(lv.minChargedARS) : 'los que cargaron') + ')</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:rgba(255,215,0,.45);"><span class="v" style="color:#ffd700;">💰 ' + _refMoney(t.commissionMonth) + '</span><span class="l">Tu comisión acumulada<br><span style="color:#777;">(' + pct + ' de la actividad de este mes' + (tiersOn ? ' · tu nivel' : '') + ')</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:rgba(255,80,80,.4);cursor:pointer;" onclick="VIP.ui.toggleReferralNetLossInfo()"><span class="v" style="color:#ff6b6b;">📉 ' + _refMoney(t.netLossMonth) + '</span><span class="l">Actividad neta de tus referidos (este mes)<br><span style="color:#ff9a9a;">ℹ️ tocá: es un monto variable</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:rgba(0,170,255,.4);"><span class="v" style="color:#4fc3ff;">📊 ' + _refMoney(t.totalCharged) + '</span><span class="l">Total cargado por<br>tus referidos</span></div>' +
            '</div>';
        html += '<div id="' + netInfoId + '" style="display:none;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.4);border-radius:10px;padding:10px;margin-bottom:10px;font-size:11.5px;line-height:1.55;color:#eee;">' +
            '<b style="color:#ff9a9a;">¿Por qué cambia este número?</b> Es el resultado neto del juego de tus referidos en el mes (lo que apostaron menos lo que ganaron), sumado. Si un referido gana, el número BAJA (y tu comisión también); si no, SUBE. Por eso puede moverse día a día. Lo que cobrás se calcula con el número final del mes y se acredita solo el 1° del mes siguiente.' +
            (t.netwinPartial ? '<br><span style="color:#ffb347;">⚠️ Ahora mismo no pudimos leer la actividad de algún referido (la plataforma está demorada): el total puede estar incompleto por unos minutos.</span>' : '') + '</div>';
        html += '<div style="background:rgba(255,255,255,.03);border-radius:10px;padding:9px 11px;margin-bottom:12px;font-size:11.5px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
            '<span style="color:#b0b0b0;">Período actual: <b style="color:#fff;">' + _esc(per.label || per.key || '—') + '</b></span>' +
            '<span style="color:#b0b0b0;">Próxima acreditación: <b style="color:#fff;">' + _esc(per.nextCredit || '—') + '</b></span></div>';
        // Tabla de referidos
        const rows = d.referrals || [];
        html += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(212,175,55,.35);border-radius:12px;padding:10px;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:13px;font-weight:900;color:#ffd700;">👥 MIS REFERIDOS (' + rows.length + ')</span></div>';
        if (!rows.length) {
            html += '<div style="color:#888;font-size:12px;padding:8px 0;">Todavía no tenés referidos. Compartí tu link y empezá a cobrar.</div>';
        } else {
            html += '<div style="overflow-x:auto;"><table class="ref-table"><thead><tr><th>Usuario</th><th>Estado</th><th style="text-align:right;">Cargado</th><th style="text-align:right;">Actividad</th><th style="text-align:right;">Tu ' + pct + '</th></tr></thead><tbody>';
            rows.forEach(r => {
                const st = r.active ? '<span class="ref-pill" style="background:rgba(0,255,136,.15);color:#00ff88;">Activo</span>' : '<span class="ref-pill" style="background:rgba(255,80,80,.15);color:#ff8080;">Sin carga</span>';
                const net = r.netLossMonth === null ? '<span style="color:#777;">…</span>' : _refMoney(Math.max(0, r.netLossMonth));
                const com = r.commissionMonth === null ? '<span style="color:#777;">…</span>' : '<b style="color:#00ff88;">' + _refMoney(r.commissionMonth) + '</b>';
                html += '<tr><td><b style="color:#fff;">' + _esc(r.username) + '</b><br><span style="color:#888;font-size:9.5px;">Se registró ' + _refAgo(r.registeredAt) + (r.qualified ? ' · ✔ activo para tu nivel' : (r.active ? ' · cargó menos de ' + _refMoney(lv.minChargedARS) : '')) + '</span></td>' +
                    '<td>' + st + '</td><td style="text-align:right;">' + _refMoney(r.totalCharged) + '</td><td style="text-align:right;color:#ff9a9a;">' + net + '</td><td style="text-align:right;">' + com + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';
        // #171 Nivel de comisión según referidos activos
        if (tiersOn) {
            const next = lv.nextTier;
            html += '<div style="background:linear-gradient(135deg,#2d0052,#1a0033);border:1.5px solid #ffd700;border-radius:12px;padding:12px;margin-bottom:12px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;"><span style="font-size:13px;font-weight:900;color:#ffd700;">🏆 TU NIVEL DE COMISIÓN</span><span style="font-size:12px;color:#fff;font-weight:900;">' + (lv.active || 0) + ' / ' + maxCount + ' <span style="font-size:9.5px;color:#aaa;font-weight:400;">referidos activos</span></span></div>' +
                '<div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px;">' +
                '<div style="font-size:34px;font-weight:900;color:#00ff88;line-height:1;">' + _refPctNum(lv.pct) + '</div>' +
                '<div style="font-size:11px;color:#ddd;line-height:1.45;">' + (lv.currentTier ? 'Estás en el nivel de <b style="color:#fff;">' + lv.currentTier.count + ' referidos activos</b>. ' : 'Todavía no llegaste al primer nivel. ') +
                (next ? 'Con <b style="color:#ffd700;">' + next.missing + ' más</b> pasás al <b style="color:#ffd700;">' + _refPctNum(next.pct) + '</b>.' : '¡Estás en el <b style="color:#ffd700;">máximo</b>!') + '</div></div>' +
                '<div style="font-size:10.5px;color:#bbb;margin:0 0 6px;">Cuantos más amigos activos traés, mayor es el % de comisión que cobrás por la actividad de TODOS tus referidos, todos los meses. Referido activo = cargó al menos <b style="color:#fff;">' + _refMoney(lv.minChargedARS) + '</b> en total.</div>' +
                '<div class="dash-ref-bar" style="height:11px;"><div class="dash-ref-fill" style="width:' + prog + '%;"></div></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' + tiers.map(x => _refTierHtml(x, lv)).join('') + '</div>' +
                (t.historicalMilestones > 0 ? '<div style="font-size:10.5px;color:#00ff88;margin-top:8px;text-align:center;">Ya cobraste ' + _refMoney(t.historicalMilestones) + ' en premios por referidos 🏆</div>' : '') +
                '</div>';
        }
        html += '<div style="font-size:10.5px;color:#888;text-align:center;line-height:1.5;">Total cobrado en comisiones: <b style="color:#d4af37;">' + _refMoney(t.historicalCommission) + '</b>. La comisión del mes se calcula con la actividad final del mes y se acredita sola el 1° del mes siguiente. Sin límite de referidos ni de ganancia.</div>';
        c.innerHTML = html;
    }

    function toggleReferralNetLossInfo() {
        const el = document.getElementById('refNetInfo');
        if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
    }

    // Card del home: nivel actual + progreso al próximo % + INVITAR AHORA (#171).
    function renderReferralHomeCard(d) {
        const c = document.getElementById('referralHomeCard');
        if (!c) return;
        if (!d) { c.style.display = 'none'; return; }
        const lv = d.level || {}, tiers = lv.tiers || [];
        const tiersOn = lv.enabled !== false && lv.mode === 'tiers' && tiers.length;
        const maxCount = lv.maxCount || (tiers.length ? tiers[tiers.length - 1].count : 10);
        const prog = Math.min(100, Math.round((lv.active || 0) / Math.max(1, maxCount) * 100));
        const steps = tiers.slice(0, 4).map(t => '<div class="dash-ref-step' + (t.reached ? ' on' : '') + '"><b>' + (t.current ? '⭐' : (t.reached ? '✅' : '🔒')) + '</b>' + t.count + ' activos<br>' + _refPctNum(t.pct) + '</div>').join('');
        const next = lv.nextTier;
        c.innerHTML = '<div class="dash-ref">' +
            '<div class="dash-ref-head"><span style="font-size:18px;">👥</span><span class="dash-ref-title">INVITÁ A TUS AMIGOS · cobrá hasta el ' + _refMaxPct(d) + '</span><button class="dash-ref-cta" onclick="VIP.ui.openReferralModal()">VER NIVELES ›</button></div>' +
            (tiersOn ? ('<div class="dash-ref-bar"><div class="dash-ref-fill" style="width:' + prog + '%;"></div></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:9.5px;color:#bbb;margin-bottom:4px;"><span>' + (lv.active || 0) + ' / ' + maxCount + ' referidos activos · cobrás <b style="color:#00ff88;">' + _refPctNum(lv.pct) + '</b></span><span style="color:#ffd700;">' + (next ? 'Te faltan ' + next.missing + ' para el ' + _refPctNum(next.pct) : '¡Nivel máximo!') + '</span></div>' +
            '<div class="dash-ref-steps">' + steps + '</div>') : '') +
            '<button class="dash-ref-invite" onclick="VIP.ui.shareReferralLink()">🔗 INVITAR AHORA</button>' +
            '</div>';
        c.style.display = '';
        try { adjustLayout(); } catch (_) {}
    }
    async function loadReferralHomeCard() {
        if (!VIP.state || !VIP.state.currentToken) return;
        const u = VIP.state.currentUser;
        if (u && u.role && u.role !== 'user') return;
        try { renderReferralHomeCard(await fetchReferralDashboard(false)); } catch (_) {}
    }

    // Popup promocional: una vez por apertura de la app (sessionStorage), solo clientes.
    // Si hay otro modal abierto (cambio de clave, bienvenida, instalación…) espera a que se
    // cierre (reintenta hasta ~2 min) y recién ahí marca "mostrado".
    let _refPromoTimer = null;
    const REF_PROMO_COOLDOWN_MS = 24 * 60 * 60 * 1000; // #319 (owner): 1 vez cada 24 h por dispositivo (antes 30 min)
    function maybeShowReferralPromo() {
        const u = VIP.state.currentUser;
        if (!u || (u.role && u.role !== 'user')) { console.info('[ref-promo] no se muestra: cuenta de staff o usuario no cargado'); return; }
        // localStorage con cooldown (no sessionStorage: iOS/Chrome restauran la pestaña y el
        // "una vez por apertura" no se disparaba nunca más). ?refpromo=1 fuerza mostrarlo.
        const force = /[?&]refpromo=1/.test(location.search || '');
        // #322: con el registro cerrado (panel → SMS y registro) el invitado no podría crear su cuenta.
        if (!force && !(VIP.flags && VIP.flags.signup === true)) { console.info('[ref-promo] no se muestra: registro cerrado'); return; }
        try {
            const last = Number(localStorage.getItem('vip_refPromoAt') || 0);
            if (!force && last && Date.now() - last < REF_PROMO_COOLDOWN_MS) { console.info('[ref-promo] ya mostrado hace ' + Math.round((Date.now() - last) / 60000) + ' min'); return; }
        } catch (_) {}
        if (_refPromoTimer) return;
        let tries = 0;
        const attempt = async () => {
            _refPromoTimer = null;
            tries++;
            const cur = VIP.state.currentUser;
            if (!cur || !VIP.state.currentToken) return;
            if (cur.mustChangePassword === true || VIP.state.passwordChangePending || VIP.state._landingCredsActive) { if (tries < 24) _refPromoTimer = setTimeout(attempt, 5000); return; }
            const open = Array.from(document.querySelectorAll('.modal')).find(m => !m.classList.contains('hidden') && m.id !== 'referralPromoModal');
            if (open) { console.info('[ref-promo] espera: modal abierto ' + open.id); if (tries < 24) _refPromoTimer = setTimeout(attempt, 5000); return; }
            try {
                const d = await fetchReferralDashboard(false);
                const ex = document.getElementById('referralPromoExtra');
                const lv = d.level || {};
                if (ex && lv.enabled !== false && lv.mode === 'tiers' && lv.tiers && lv.tiers.length) ex.textContent = 'Tu % sube con tus amigos activos: ' + lv.tiers.map(t => t.count + ' amigos = ' + _refPctNum(t.pct)).join(' · ');
            } catch (_) {}
            try { localStorage.setItem('vip_refPromoAt', String(Date.now())); } catch (_) {}
            console.info('[ref-promo] mostrando');
            showModal('referralPromoModal');
        };
        _refPromoTimer = setTimeout(attempt, 1800);
    }

    // #170 Invitar: copia el link SIEMPRE y abre un chooser con WhatsApp, Telegram, otras apps y copiar.
    // #317: el texto que se comparte es el del comando /sys_referidos_compartir (#308b, editable
    // en COMANDOS, viene en /api/rewards/summary); si no está, uno por defecto. Siempre con el link.
    function _refShareText(link) {
        const sum = VIP.ui._rwSummary || {};
        let tpl = sum.referralShareTpl || '🎰 Sumate a la sala con mi link y jugá con cargas automáticas en segundos 👉 {link}';
        tpl = String(tpl).replace(/\{link\}/g, link || '').replace(/\{codigo\}/g, (_refData && _refData.referralCode) || '').replace(/\{pct\}/g, String(_refMaxPct(_refData)).replace('%', ''));
        if (link && tpl.indexOf(link) === -1) tpl += '\n' + link;
        return tpl;
    }
    async function shareReferralLink() {
        let link = (_refData && _refData.referralLink) || null;
        if (!link) { try { link = (await fetchReferralDashboard(false)).referralLink; } catch (_) {} }
        if (!link) { showToast('No pudimos generar tu link. Probá de nuevo.', 'error'); return; }
        const pct = _refMaxPct(_refData);
        const text = _refShareText(link);
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch (_) { try { fallbackCopy(link); copied = true; } catch (_) {} }
        const old = document.getElementById('referralShareChooser'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'referralShareChooser';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(3px);z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:14px;'; // #317: arriba del casino y del hub PREMIOS
        ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
        const enc = encodeURIComponent(text);
        const WA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
        const TG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
        const item = (bg, icon, title, sub, onclick) =>
            '<button onclick="' + onclick + '" style="width:100%;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px 12px;cursor:pointer;margin-top:8px;text-align:left;color:#fff;transition:background .15s;" onmouseover="this.style.background=\'rgba(255,255,255,.08)\'" onmouseout="this.style.background=\'rgba(255,255,255,.04)\'">' +
            '<span style="flex-shrink:0;width:42px;height:42px;border-radius:12px;background:' + bg + ';display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.35);">' + icon + '</span>' +
            '<span style="flex:1;min-width:0;"><span style="display:block;font-weight:800;font-size:14px;">' + title + '</span><span style="display:block;font-size:11px;color:#aab;line-height:1.3;">' + sub + '</span></span>' +
            '<span style="color:#888;font-size:18px;">›</span></button>';
        ov.innerHTML = '<div style="background:#14062b;border:1px solid rgba(255,215,0,.45);border-radius:18px;padding:16px;max-width:420px;width:100%;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.6);">' +
            '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">' +
            '<span style="flex-shrink:0;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#d4af37,#ffd700);display:flex;align-items:center;justify-content:center;font-size:20px;">🔗</span>' +
            '<div style="flex:1;min-width:0;"><div style="font-weight:900;font-size:16px;letter-spacing:.2px;">Invitá a tus amigos</div>' +
            '<div style="font-size:12px;color:#aab;margin-top:2px;">Cobrás hasta el <b style="color:#ffd700;">' + pct + '</b> de comisión por la actividad de tus amigos: cuantos más activos, mayor tu %.</div></div>' +
            '<button onclick="document.getElementById(\'referralShareChooser\').remove()" aria-label="Cerrar" style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#ccc;font-size:16px;cursor:pointer;">✕</button></div>' +
            '<div style="background:rgba(0,0,0,.35);border:1px dashed rgba(255,215,0,.35);border-radius:10px;padding:9px 11px;display:flex;align-items:center;gap:8px;">' +
            '<span style="flex:1;min-width:0;font-size:11.5px;color:#9ff2c7;word-break:break-all;font-family:ui-monospace,Menlo,monospace;">' + _esc(link) + '</span>' +
            '<span style="flex-shrink:0;font-size:10.5px;font-weight:800;color:' + (copied ? '#00ff88' : '#ffd700') + ';white-space:nowrap;">' + (copied ? '✓ Copiado' : '') + '</span></div>' +
            '<div style="font-size:10.5px;color:#778;margin:10px 0 2px;text-transform:uppercase;letter-spacing:1px;font-weight:800;">Enviar por</div>' +
            item('#25d366', WA, 'WhatsApp', 'Se abre con el mensaje y tu link listos', 'window.open(\'https://wa.me/?text=' + enc + '\',\'_blank\')') +
            item('#229ed9', TG, 'Telegram', 'Elegí el chat o grupo donde compartirlo', 'window.open(\'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text.replace(link, '').trim()) + '\',\'_blank\')') +
            (navigator.share ? item('linear-gradient(135deg,#7c3aed,#4f46e5)', '<span style="font-size:20px;">📤</span>', 'Otras apps', 'Instagram, SMS, Messenger, correo…', 'VIP.ui.shareReferralNative()') : '') +
            item('rgba(255,215,0,.16)', '<span style="font-size:20px;">📋</span>', 'Copiar el link', 'Para pegarlo donde quieras', 'VIP.ui.copyReferralLink()') +
            '</div>';
        document.body.appendChild(ov);
    }
    async function shareReferralNative() {
        const link = (_refData && _refData.referralLink) || '';
        const text = _refShareText(link);
        try { await navigator.share({ title: 'Invitación', text }); const ov = document.getElementById('referralShareChooser'); if (ov) ov.remove(); } catch (e) { /* cancelado */ }
    }
    function copyReferralLink() {
        const link = (_refData && _refData.referralLink) || (document.getElementById('myReferralLink') || {}).textContent || '';
        if (link && link !== '—') navigator.clipboard.writeText(link).then(() => showToast('✅ Link copiado', 'success')).catch(() => fallbackCopy(link));
    }
    function copyReferralCode() { copyReferralLink(); } // legacy: el código ya no se muestra suelto

    // ---- Canal informativo (delegated from chat module) ----

    function loadCanalInformativoUrl() {
        return VIP.chat.loadCanalInformativoUrl();
    }

    // ---- PWA install ----

    async function installApp() {
        const ua        = navigator.userAgent;
        const isIOS     = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        const isAndroid = /Android/.test(ua);
        const isWindows = /Windows/.test(ua);
        const isMac     = /Macintosh|MacIntel/.test(ua) && !isIOS;

        if (!window.deferredPrompt) {
            if (isIOS)          showInstallInstructions('ios');
            else if (isAndroid) showInstallInstructions('android');
            else if (isWindows) showInstallInstructions('windows');
            else if (isMac)     showInstallInstructions('mac');
            else                showInstallInstructions('generic');
            return;
        }

        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            showToast('✅ Instalando app...', 'success');
            // Recordatorio de notificaciones para Android (flujo directo via deferredPrompt)
            setTimeout(() => {
                showInstallInstructions('android-notif');
            }, 2000);
        } else {
            showToast('❌ Instalación cancelada', 'error');
        }
        window.deferredPrompt = null;
    }

    function showInstallInstructions(platform) {
        const modal = document.createElement('div');
        modal.className = 'ios-install-modal';

        let title, steps, note;
        // Plataformas móviles: se muestra el aviso de notificaciones
        const isMobilePlatform = platform === 'ios' || platform === 'android' || platform === 'android-notif';

        // Pantalla dedicada de recordatorio de notificaciones post-instalación (Android nativo)
        if (platform === 'android-notif') {
            modal.innerHTML = `
                <div class="ios-install-content">
                    <h3>🔔 Un paso más</h3>
                    <div style="
                        background: rgba(255, 107, 53, 0.15);
                        border: 2px solid #ff6b35;
                        border-radius: 10px;
                        padding: 14px 16px;
                        text-align: left;
                    ">
                        <p style="margin: 0; color: #ff6b35; font-weight: bold; font-size: 15px;">
                            🔔 LO MÁS IMPORTANTE: PERMITIR NOTIFICACIONES
                        </p>
                        <p style="margin: 10px 0 0; color: #fff; font-size: 13px;">
                            Cuando abras la app instalada y te pida acceso,
                            <strong>aceptá y permitir notificaciones</strong>.<br>
                            Sin esto, <u>no te van a llegar los avisos importantes</u>.
                        </p>
                    </div>
                    <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
                </div>
            `;
            document.body.appendChild(modal);
            return;
        }

        if (platform === 'ios') {
            title = '📱 Instalar en iPhone / iPad';
            note  = '⚠️ <strong>Solo funciona desde Safari.</strong>';
            steps = [
                'Abrí esta página en <strong>Safari</strong> (no Chrome, no otro navegador)',
                'Tocá el botón <strong>Compartir</strong> <span style="font-size:18px">⬆️</span> en la barra inferior de Safari',
                'Deslizá hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong>',
                'Presioná <strong>"Agregar"</strong>'
            ];
        } else if (platform === 'android') {
            title = '📱 Instalar en Android';
            note  = '⚠️ <strong>Solo funciona desde Google Chrome.</strong>';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong>',
                'Tocá el ícono <strong>⋮</strong> (tres puntos) en la esquina superior derecha',
                'Seleccioná <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong>',
                'Presioná <strong>"Agregar"</strong> o <strong>"Instalar"</strong>'
            ];
        } else if (platform === 'windows') {
            title = '💻 Instalar en Windows (PC)';
            note  = '💡 Funciona en Chrome o Edge.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>',
                'En Chrome: hacé clic en el ícono de instalación <strong>⊕</strong> en la barra de direcciones',
                'En Edge: hacé clic en el ícono <strong>⊕</strong> o el menú <strong>⋯</strong> → <strong>"Aplicaciones"</strong> → <strong>"Instalar este sitio como aplicación"</strong>',
                'Confirmá la instalación'
            ];
        } else if (platform === 'mac') {
            title = '💻 Instalar en Mac';
            note  = '💡 Funciona en Chrome o Safari.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Safari</strong>',
                'En Chrome: hacé clic en el ícono <strong>⊕</strong> en la barra de direcciones',
                'En Safari: usá <strong>Archivo → Agregar a Dock</strong> (macOS Sonoma o superior)',
                'Confirmá la instalación'
            ];
        } else {
            title = '📱 Instalar App';
            note  = '';
            steps = [
                'Abrí esta página en <strong>Chrome</strong> o <strong>Safari</strong>',
                'Buscá la opción <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong> en el menú del navegador',
                'Confirmá la instalación'
            ];
        }

        // Aviso de notificaciones destacado para iOS y Android
        const notifWarning = isMobilePlatform ? `
            <div style="
                background: rgba(255, 107, 53, 0.15);
                border: 2px solid #ff6b35;
                border-radius: 10px;
                padding: 12px 15px;
                margin-top: 15px;
                text-align: left;
            ">
                <p style="margin: 0; color: #ff6b35; font-weight: bold; font-size: 14px;">
                    🔔 LO MÁS IMPORTANTE: PERMITIR NOTIFICACIONES
                </p>
                <p style="margin: 8px 0 0; color: #fff; font-size: 13px;">
                    Una vez instalada, cuando la app te pida acceso, <strong>aceptá y permitir notificaciones</strong>.
                    Sin esto, <u>no te van a llegar los avisos importantes</u>.
                </p>
            </div>` : '';

        modal.innerHTML = `
            <div class="ios-install-content">
                <h3>${title}</h3>
                ${note ? `<p style="color: #f7931e; margin-bottom: 12px;">${note}</p>` : ''}
                <ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>
                ${notifWarning}
                <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function isAppInstalled() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                           window.navigator.standalone === true;
        if (!standalone) return false;
        // Also require notification permission to be granted
        const notifGranted = ('Notification' in window) && Notification.permission === 'granted';
        return notifGranted;
    }

    function isAppStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }

    return {
        showModal,
        hideModal,
        showToast,
        copyText,
        copyToClipboard,
        fallbackCopy,
        showLoginScreen,
        showChatScreen,
        adjustLayout,
        syncBalance,
        handleBalancePush,
        showCasinoInvite,
        hideCasinoInvite,
        casinoInviteJoinCommunity,
        casinoInviteAlreadyIn,
        showBalanceToast,
        updateBalanceDisplay,
        startBalancePolling,
        stopBalancePolling,
        sendWelcomeMessages,
        loadAndShowCBU,
        openReferralModal,
        loadReferralData,
        copyReferralCode,
        copyReferralLink,
        loadReferralHomeCard,
        maybeShowReferralPromo,
        shareReferralLink,
        shareReferralNative,
        toggleReferralNetLossInfo,
        fetchReferralDashboard,
        loadCanalInformativoUrl,
        installApp,
        showInstallInstructions,
        isAppInstalled,
        isAppStandalone
    };

})();

// Window aliases for onclick="..." in HTML
window.showModal             = VIP.ui.showModal;
window.hideModal             = VIP.ui.hideModal;
window.showToast             = VIP.ui.showToast;
window.copyText              = VIP.ui.copyText;
window.copyToClipboard       = VIP.ui.copyToClipboard;
window.copyReferralCode      = VIP.ui.copyReferralCode;
window.copyReferralLink      = VIP.ui.copyReferralLink;
window.installApp            = VIP.ui.installApp;
window.showInstallInstructions = VIP.ui.showInstallInstructions;

// ---- PWA install prompt event handlers (must be top-level) ----

window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        return;
    }
    window.deferredPrompt = e;
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'flex'; loginInstallBtn.classList.remove('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'flex'; headerInstallBtn.classList.remove('hidden'); }
    if (appInstallBtn)    { appInstallBtn.style.display = 'flex'; appInstallBtn.classList.add('show'); }
});

window.addEventListener('appinstalled', () => {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
    window.deferredPrompt = null;
    VIP.ui.showToast('✅ App instalada exitosamente', 'success');
});

// Hide install buttons if already running as standalone
if (VIP.ui.isAppStandalone()) {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
}


// Platform modal — private state (no DOM exposure for sensitive data)
VIP.ui._platformPasswordVisible = false;

VIP.ui._copyUsernameToClipboard = function(username, onSuccess) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(username).then(onSuccess).catch(function() {
      VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
    });
  } else {
    VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
  }
};

VIP.ui.openPlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (!modal) return;
  const username = VIP.state.currentUser?.username || '';
  const userEl = document.getElementById('platformModalUser');
  if (userEl) userEl.textContent = username || 'Usuario';

  // Mostrar contraseña si está disponible en memoria de sesión (sin exponerla en el DOM)
  const pwd = VIP.state.sessionPassword || '';
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = pwd ? '••••••••' : '—';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = pwd ? 'none' : 'block';

  // Resetear feedback de copia
  const feedback = document.getElementById('platformCopyFeedback');
  if (feedback) feedback.style.display = 'none';

  modal.style.display = 'flex';

  // Auto-copiar usuario al abrir el modal
  if (username) {
    VIP.ui._copyUsernameToClipboard(username, function() {
      if (feedback) feedback.style.display = 'block';
      VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
    });
  }
};

VIP.ui.closePlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (modal) modal.style.display = 'none';
};

VIP.ui.copyPlatformUsername = function() {
  const username = VIP.state.currentUser?.username || '';
  if (!username) return;
  const feedback = document.getElementById('platformCopyFeedback');
  VIP.ui._copyUsernameToClipboard(username, function() {
    if (feedback) feedback.style.display = 'block';
    VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
  });
};

// ============================================
// ENTRAR AL CASINO — login único (SSO) contra 1girox
// ============================================
//
// Antes: se abría el casino y el usuario tenía que copiar y pegar su usuario y
// contraseña a mano. Ahora el backend pide un link de acceso directo
// (POST /api/platform/session → 1girox POST /players/{username}/session) y el
// usuario entra ya logueado.
//
// ⚠️ POP-UP BLOCKER: el link viene de un fetch (asíncrono) y los navegadores —sobre
// todo en mobile— bloquean window.open si no ocurre DENTRO del gesto del usuario.
// Por eso la pestaña se abre PRIMERO, vacía, y recién después se le cambia la URL.
// Además el código de acceso vence a los 60 segundos, así que no se cachea nada.
VIP.ui._casinoOpening = false;

/**
 * Abre el casino EMBEBIDO en un recuadro a pantalla completa, dentro de la PWA.
 * El jugador nunca sale de VIPCARGAS: cierra el recuadro con la ✕ y vuelve al chat.
 *
 * Orden de las cosas (importa):
 *   1. Se muestra el recuadro con un "cargando" — INMEDIATO, en el mismo click.
 *   2. Recién ahí se pide el link de acceso al backend.
 *   3. Apenas llega, se carga en el iframe.
 *
 * ⚠️ Por qué se pide el link DESPUÉS de abrir el recuadro y no antes: el código de
 * acceso vence a los 60 SEGUNDOS y es de un solo uso. Cuanto menos tiempo pase entre
 * que la plataforma lo emite y el navegador lo usa, mejor. En conexiones lentas (o por
 * Tor) pedirlo antes y usarlo después llegaba vencido: "El enlace expiró".
 */
VIP.ui._casinoOpen = false;

// ============================================================
// #288 MODO INVITADO (owner 2026-09-24): sin sesión, el visitante ve el MISMO
// formato que un cliente logueado — el casino de fondo (sitio público de
// 1girox, sin SSO) y el widget flotante — pero el widget, en vez del chat/bot,
// muestra el recuadro de INGRESAR / REGISTRARSE (se MUDA el .login-box de la
// pantalla vieja adentro del panel: conserva ids, listeners y todos los flujos:
// registro, OTP, recuperar clave, publicista, reseñas, regalos). Al loguearse,
// showChatScreen → _guestExit devuelve el recuadro y enterCasino carga el SSO
// en el mismo iframe.
// ============================================================
VIP.ui._guestMode = false;
VIP.ui.enterCasinoGuest = function() {
  if (VIP.state && VIP.state.currentToken) return false;
  const box = document.querySelector('#loginScreen .login-box');
  if (!box) return false;
  VIP.ui._guestMode = true;
  VIP.ui._botStarted = true; // que openCasinoChat no dibuje el bot (está oculto)
  VIP.ui._showCasinoFrame();
  const overlay = document.getElementById('casinoOverlay');
  const frame = document.getElementById('casinoFrame');
  const status = document.getElementById('casinoFrameStatus');
  // Los modales del login (OTP, reseñas, regalos, recuperar clave, bienvenida
  // del publicista) tienen z-index 10000: el overlay baja a 9000 mientras es
  // invitado para que se vean ARRIBA. Al loguearse vuelve a 99999.
  if (overlay) overlay.style.zIndex = '9000';
  if (status) status.textContent = '🎰 Cargando el casino…';
  if (frame) { frame.src = VIP.config.PLATFORM_URL; frame.style.display = 'block'; }
  try { document.getElementById('loginScreen').classList.add('hidden'); } catch (e) {}
  // --- widget en modo invitado ---
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) {
    drawer.querySelectorAll('.cwBar, .cwFoot').forEach(function(el) { if (el.id !== 'casinoCommunityRow') el.style.display = 'none'; });
    const bot = document.getElementById('casinoBotArea'); if (bot) bot.style.display = 'none';
    const title = document.getElementById('casinoWidgetTitle'); if (title) title.textContent = (VIP.flags && VIP.flags.signup === true) ? 'Ingresá o creá tu cuenta' : 'Ingresá a tu cuenta';
    const body = document.getElementById('casinoChatDrawerBody');
    if (body) {
      let wrap = document.getElementById('guestAuthWrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'guestAuthWrap';
        wrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px;';
        body.appendChild(wrap);
      }
      if (!VIP.ui._guestBoxPh) {
        const ph = document.createElement('div'); ph.style.display = 'none';
        box.parentNode.insertBefore(ph, box);
        VIP.ui._guestBoxPh = ph;
      }
      wrap.classList.add('guest-premium');
      wrap.appendChild(box);
      body.style.display = 'flex';
      try { VIP.ui._guestSkin(box); } catch (e) {}
    }
  }
  document.body.classList.add('guest-premium'); // skin de los modales (registro, recuperar, etc.)
  const bubble = document.getElementById('casinoSupportBubble');
  if (bubble) { const lbl = bubble.querySelectorAll(':scope > span')[1]; if (lbl) { VIP.ui._guestBubbleLbl = lbl.textContent; lbl.textContent = (VIP.flags && VIP.flags.signup === true) ? '🔑 INGRESAR / REGISTRARTE' : '🔑 INGRESAR'; } }
  setTimeout(function() { try { VIP.ui.openCasinoChat(); } catch (e) {} }, 300);
  return true;
};
// Skin PREMIUM del recuadro (#288b, owner: "algo más premium, no una copia
// de lo que había"). No se rediseña la lógica: los nodos originales siguen
// ahí (ids/listeners/flujos intactos); se ESCONDEN los bloques viejos y se
// agregan cabecera, tabs y pie (.gp-only) que actúan de PROXY de los botones
// reales (Registrarse, Recuperar, Soporte Telegram, Reseñas, Regalos). El CSS
// vive en /css/guest.css y solo aplica dentro de .guest-premium.
VIP.ui._guestSkin = function(box) {
  const form = document.getElementById('loginForm');
  if (!box || !form) return;
  const syncTabs = function() {
    const rb = document.getElementById('registerBtn');
    const tab = document.getElementById('gpTabRegister');
    if (!tab) return;
    tab.style.display = (!rb || rb.style.display === 'none') ? 'none' : '';
    if (rb && /referido/i.test(rb.textContent || '')) tab.textContent = '🤝 Registrarse con código';
  };
  if (box._gpSkinned) { syncTabs(); return; }
  box._gpSkinned = true;
  // 1) Esconder los bloques viejos (se identifican por lo que contienen).
  Array.from(box.children).forEach(function(el) {
    if (el.id === 'loginForm' || el.id === 'loginClaimsTicker' || el.id === 'errorMessage') return;
    if (el.querySelector && el.querySelector('#helpTelegramBtn, #loginReviewsBtn, #loginGiftsBtn, #registerBtn, #findUserBtn')) { el.classList.add('gp-hide'); return; }
    if (el.tagName === 'P') { el.classList.add('gp-hide'); return; }
    if (/Verific/i.test(el.textContent || '')) { el.classList.add('gp-hide'); return; }
  });
  // 2) Cabecera premium.
  const head = document.createElement('div');
  head.className = 'gp-only gp-head';
  head.innerHTML = '<img class="gp-logo" src="/images/soporte-1girox.png" alt="1GIROX">' +
    '<div class="gp-brand">1GIROX</div>' +
    '<div class="gp-tag">Sala de juegos VIP · Cargas automáticas 24/7</div>';
  box.insertBefore(head, box.firstChild);
  // 3) Tabs Ingresar / Crear cuenta (el segundo dispara el botón REAL de registro).
  const tabs = document.createElement('div');
  tabs.className = 'gp-only gp-tabs';
  tabs.innerHTML = '<button type="button" class="gp-tab active">🔑 Ingresar</button>' +
    '<button type="button" class="gp-tab" id="gpTabRegister">📝 Crear cuenta</button>';
  box.insertBefore(tabs, form);
  tabs.querySelector('#gpTabRegister').addEventListener('click', function() {
    const b = document.getElementById('registerBtn'); if (b) b.click();
  });
  // 4) Pie: confianza + recuperar clave + accesos (proxies de los botones reales).
  const foot = document.createElement('div');
  foot.className = 'gp-only gp-foot';
  foot.innerHTML =
    '<div class="gp-trust"><span>🔒 Pagos seguros</span><span>⚡ Carga automática</span><span>🎁 Bono en tu 1ª carga</span></div>' +
    '<button type="button" class="gp-forgot" id="gpForgot">¿Olvidaste tu contraseña? Recuperala</button>' +
    '<div class="gp-links">' +
      '<button type="button" class="gp-link" id="gpTg">📣 Soporte Telegram</button>' +
      '<button type="button" class="gp-link" id="gpRev">⭐ Reseñas</button>' +
      '<button type="button" class="gp-link" id="gpGift">🎁 Regalos</button>' +
    '</div>' +
    '<div class="gp-note">🔒 Verificá tu teléfono después de entrar: recuperás la cuenta y retirás sin problemas.</div>';
  form.insertAdjacentElement('afterend', foot);
  const proxy = function(fromId, toId) {
    const a = document.getElementById(fromId), b = document.getElementById(toId);
    if (a && b) a.addEventListener('click', function() { b.click(); });
    else if (a) a.style.display = 'none';
  };
  proxy('gpForgot', 'findUserBtn'); proxy('gpTg', 'helpTelegramBtn'); proxy('gpRev', 'loginReviewsBtn'); proxy('gpGift', 'loginGiftsBtn');
  syncTabs();
  // La personalización del publicista (applyLoginCustomizations) puede llegar
  // después y ocultar/renombrar "Registrarse" → se re-sincroniza un par de veces.
  setTimeout(syncTabs, 400); setTimeout(syncTabs, 1500);
};

VIP.ui._guestExit = function() {
  if (!VIP.ui._guestMode) return;
  VIP.ui._guestMode = false;
  document.body.classList.remove('guest-premium');
  // #290b: el overlay quedó abierto en modo invitado, y los callers del login
  // (`if (!VIP.ui._casinoOpen) enterCasino()`) lo tomaban como "ya está en el
  // casino" → no cargaban el SSO ni refrescaban PREMIOS hasta recargar la
  // página. Se baja la bandera: _showCasinoFrame reusa el overlay igual.
  VIP.ui._casinoOpen = false;
  VIP.ui._botStarted = false;
  const box = document.querySelector('#guestAuthWrap .login-box');
  const ph = VIP.ui._guestBoxPh;
  if (box && ph && ph.parentNode) { ph.parentNode.insertBefore(box, ph); ph.remove(); }
  VIP.ui._guestBoxPh = null;
  const wrap = document.getElementById('guestAuthWrap'); if (wrap) wrap.remove();
  const body = document.getElementById('casinoChatDrawerBody'); if (body) body.style.display = 'none';
  const bot = document.getElementById('casinoBotArea'); if (bot) bot.style.display = 'flex';
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) drawer.querySelectorAll('.cwBar, .cwFoot').forEach(function(el) { if (el.id !== 'casinoCommunityRow') el.style.display = 'flex'; });
  const title = document.getElementById('casinoWidgetTitle'); if (title) title.textContent = 'Cargas Automáticas 1Girox';
  const bubble = document.getElementById('casinoSupportBubble');
  if (bubble && VIP.ui._guestBubbleLbl) { const lbl = bubble.querySelectorAll(':scope > span')[1]; if (lbl) lbl.textContent = VIP.ui._guestBubbleLbl; }
  const overlay = document.getElementById('casinoOverlay'); if (overlay) overlay.style.zIndex = '99999';
  try { VIP.ui.closeCasinoChat(); } catch (e) {}
};

VIP.ui.enterCasino = async function() {
  if (VIP.ui._casinoOpening) return; // anti doble-click
  VIP.ui._casinoOpening = true;
  try { VIP.ui._guestExit(); } catch (e) {} // #288

  VIP.ui.closePlatformModal();
  VIP.ui._showCasinoFrame();   // recuadro visible YA, con "cargando"

  try {
    const response = await fetch(`${VIP.config.API_URL}/api/platform/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VIP.state.currentToken}`
      }
    });
    const data = await response.json();

    if (response.ok && data.success && data.redirectUrl) {
      if (data.logoutUrl) VIP.state._casinoLogoutUrl = data.logoutUrl;
      // Carga "fresca": primero mata la sesión anterior de 1girox en el iframe
      // (si conocemos su URL de logout) y recién después el SSO (#252).
      VIP.ui._loadCasinoUrlFresh(data.redirectUrl);
      return;
    }

    VIP.ui._casinoFrameError(data.error || 'No pudimos abrirte el casino en este momento.');
  } catch (error) {
    VIP.ui._casinoFrameError('Sin conexión. Revisá tu internet e intentá de nuevo.');
  } finally {
    VIP.ui._casinoOpening = false;
  }
};

/**
 * Camino RÁPIDO de la landing: el link SSO ya vino adelantado en el canje del
 * access-link (una sola ida al server), así que acá no se pide nada — se abre
 * el recuadro y se carga el casino DIRECTO. El código SSO vence a los 60s pero
 * se usa en el mismo instante en que llegó. Si por lo que sea no hay URL, cae
 * al camino normal (enterCasino pide la sesión como siempre).
 */
VIP.ui.enterCasinoWithUrl = function(url) {
  if (!url) return VIP.ui.enterCasino();
  try { VIP.ui._guestExit(); } catch (e) {} // #288
  VIP.ui.closePlatformModal();
  VIP.ui._showCasinoFrame();
  VIP.ui._loadCasinoUrlFresh(url);
};

/**
 * Carga el SSO en el iframe del casino matando ANTES la sesión anterior de
 * 1girox (#252, 2026-08-28). Problema real: en un mismo celular, si el usuario A
 * ya tenía sesión en 1girox (cookie del iframe) y la PWA pasa al usuario B, el
 * link SSO de B podía caer sobre la sesión viva de A → casino = A, chat = B.
 * Si el back nos dio la URL de logout (SSM `GIROX_PLAY_LOGOUT_URL`), primero se
 * navega ahí (borra la cookie), y al `load` (o a los 1500ms, lo que ocurra
 * primero) se carga el SSO. Sin URL de logout, va el SSO directo como antes.
 */
VIP.ui._loadCasinoUrlFresh = function(url) {
  const frame = document.getElementById('casinoFrame');
  if (!frame) return;
  const lo = VIP.state._casinoLogoutUrl;
  let done = false;
  const go = function() {
    if (done) return;
    done = true;
    VIP.ui._casinoLogoutLoading = false;
    frame.src = url;
    // Red de seguridad: aviso "abrir aparte" solo si el iframe no carga en 12s.
    VIP.ui._armCasinoEscape();
  };
  if (!lo || VIP.ui._casinoSessionKilled) { VIP.ui._casinoSessionKilled = false; go(); return; }
  VIP.ui._casinoLogoutLoading = true;
  const onLo = function() { frame.removeEventListener('load', onLo); go(); };
  frame.addEventListener('load', onLo);
  frame.src = lo;
  setTimeout(go, 1500);
};

/** Mata la sesión de 1girox del dispositivo cargando su URL de logout en un
 *  iframe OCULTO (no toca el casino visible). Best-effort; si no hay URL, nada. */
VIP.ui._killCasinoSession = function() {
  const lo = VIP.state._casinoLogoutUrl;
  if (!lo) return;
  try {
    let f = document.getElementById('casinoLogoutFrame');
    if (!f) {
      f = document.createElement('iframe');
      f.id = 'casinoLogoutFrame';
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;';
      document.body.appendChild(f);
    }
    f.src = lo;
    VIP.ui._casinoSessionKilled = true;
  } catch (e) {}
};

/** "Cambiar de cuenta" desde el widget (#252): cierra el casino, mata la sesión
 *  de 1girox y hace el logout de la PWA → pantalla de login. Antes NO había forma
 *  de cerrar sesión en el formato casino (el botón quedó en el menú viejo, tapado),
 *  y la gente cambiaba de usuario ADENTRO de 1girox → chat de A, casino de B. */
VIP.ui.casinoLogout = function() {
  if (!confirm('¿Cerrar sesión para entrar con otra cuenta?')) return;
  try { VIP.ui.casinoRouletteClose(true); } catch (e) {}
  try { if (VIP.auth && VIP.auth.handleLogout) VIP.auth.handleLogout(); } catch (e) {}
};

/**
 * RED DE SEGURIDAD universal (owner 2026-08-21): a los 12s, MUESTRA un aviso
 * discreto abajo del casino para abrirlo APARTE. A diferencia del watchdog,
 * este timer NO se cancela con el `load` del iframe — porque el caso que nos
 * importa (cookies de terceros bloqueadas en Tor / Safari-iPhone) hace que el
 * HTML cargue —load dispara— pero la sesión quede girando adentro, algo que
 * desde afuera no se puede detectar. Para el que le carga bien (Android), el
 * aviso es una barrita chica abajo que puede cerrar con la ✕.
 */
VIP.ui._armCasinoEscape = function() {
  VIP.ui._casinoFrameLoaded = false; // se pone true en el `load` del iframe
  clearTimeout(VIP.ui._casinoEscapeTimer);
  VIP.ui._casinoEscapeTimer = setTimeout(function() {
    if (!VIP.ui._casinoOpen) return;
    // Si el casino YA cargó, no se muestra NADA (aunque adentro esté trabado
    // por cookies, el propio casino muestra su estado). El aviso es solo para
    // cuando el iframe ni siquiera cargó.
    if (VIP.ui._casinoFrameLoaded) return;
    VIP.ui._showCasinoEscapeBar();
  }, 12000);
};

VIP.ui._showCasinoEscapeBar = function() {
  if (VIP.ui._casinoFrameLoaded) return; // cargó bien → sin cartel
  if (document.getElementById('casinoEscapeBar')) return;
  const overlay = document.getElementById('casinoOverlay');
  if (!overlay) return;
  const bar = document.createElement('div');
  bar.id = 'casinoEscapeBar';
  bar.style.cssText =
    'position:absolute;left:12px;right:12px;z-index:8;' +
    'bottom:calc(12px + env(safe-area-inset-bottom,0px));' +
    'background:linear-gradient(135deg,#1a0033,#2d0052);border:1px solid #ffd70066;' +
    'border-radius:14px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,0.6);' +
    'display:flex;flex-direction:column;gap:8px;max-width:520px;margin:0 auto;';
  bar.innerHTML =
    '<button type="button" onclick="VIP.ui._hideCasinoEscapeBar()" ' +
      'style="position:absolute;top:6px;right:10px;background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1;">×</button>' +
    '<div style="color:#ffd479;font-weight:800;font-size:13.5px;line-height:1.4;">' +
      '🎰 ¿El juego no termina de abrir?</div>' +
    '<div style="color:#cbb8e6;font-size:12px;line-height:1.45;">' +
      'Tu navegador puede estar bloqueando el casino acá adentro. Tocá para abrirlo aparte y va a funcionar normal.<br>' +
      '<b style="color:#9ad8f7;">💬 Usá ESTA página para cargar o retirar tu saldo.</b></div>' +
    '<button type="button" onclick="VIP.ui.openCasinoInTab()" ' +
      'style="background:linear-gradient(135deg,#d4af37,#ffd700);color:#000;border:none;' +
      'padding:12px;border-radius:12px;font-weight:900;font-size:14px;cursor:pointer;">↗ Abrir el juego aparte</button>';
  overlay.appendChild(bar);
};

VIP.ui._hideCasinoEscapeBar = function() {
  const b = document.getElementById('casinoEscapeBar');
  if (b) b.remove();
};

// ============================================================
// ENTRADA POR LANDING v4 (`ir=creds`, owner 2026-08-19): recuadro de
// usuario+clave APENAS carga la PWA. Mientras el cliente lee sus datos, por
// atrás ya se canjeó el link, se conectó el chat y quedó el SSO listo →
// "ENTRAR AL CASINO" abre 1girox al instante (la espera se solapa, no se suma).
// ============================================================

/** Muestra el recuadro de credenciales (lo llama tryAccessLink ANTES del canje;
 *  el botón queda "Preparando…" hasta que el canje confirma). */
VIP.ui._showLandingCredsScreen = function(creds) {
  let ov = document.getElementById('landingCredsOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'landingCredsOverlay';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:99998;background:#0d0d1a;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;padding-top:calc(24px + env(safe-area-inset-top,0px));';
    ov.innerHTML =
      '<div style="width:min(420px,100%);background:#151226;border:1px solid rgba(212,175,55,0.4);' +
      'border-radius:18px;padding:26px 22px;text-align:center;box-shadow:0 14px 44px rgba(0,0,0,0.6);">' +
        '<div style="font-size:34px;">🎰</div>' +
        '<div style="color:#25d366;font-weight:900;font-size:20px;margin:6px 0 2px;">¡Tu cuenta está lista!</div>' +
        '<div style="color:#a7b7a8;font-size:13px;margin-bottom:16px;">Guardá tus datos para volver a entrar cuando quieras.</div>' +
        '<div style="background:#0d0b16;border:1px dashed rgba(212,175,55,0.5);border-radius:12px;' +
        'padding:12px;margin-bottom:18px;text-align:left;">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 2px;">' +
            '<span style="color:#8a8fa3;font-size:13px;">Usuario</span>' +
            '<b id="landingCredsUser" style="color:#fff;font-size:15px;word-break:break-all;">…</b></div>' +
          '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 2px;">' +
            '<span style="color:#8a8fa3;font-size:13px;">Clave</span>' +
            '<b id="landingCredsPass" style="color:#e3bd48;font-size:15px;">…</b></div>' +
        '</div>' +
        '<button type="button" id="landingCredsEnter" onclick="VIP.ui.landingEnterCasino()" ' +
          'style="width:100%;background:linear-gradient(135deg,#128c4a,#25d366);color:#fff;border:none;' +
          'border-radius:14px;padding:15px;font-size:16px;font-weight:900;cursor:pointer;">⏳ Preparando tu cuenta…</button>' +
      '</div>';
    document.body.appendChild(ov);
  }
  if (creds && creds.username) document.getElementById('landingCredsUser').textContent = creds.username;
  if (creds && creds.password) document.getElementById('landingCredsPass').textContent = creds.password;
  VIP.ui._landingCredsShownAt = Date.now();
  VIP.ui._landingCredsReadyFlag = false;
  ov.style.display = 'flex';
  // AUTO-INICIO a los 10s (owner 2026-08-21): si el cliente se queda mirando,
  // entra solo al casino pasado ese máximo. Solo si el canje ya terminó.
  clearTimeout(VIP.ui._landingAutoEnterTimer);
  VIP.ui._landingAutoEnterTimer = setTimeout(function() {
    if (VIP.state._landingCredsActive && VIP.ui._landingCredsReadyFlag) {
      VIP.ui.landingEnterCasino();
    }
  }, 10000);
};

/** El canje terminó OK: habilita el botón (y completa el usuario si el
 *  fragmento no vino — la clave en ese caso queda en el mensaje del chat).
 *  El botón se habilita recién a los 2 SEGUNDOS de mostrarse la pantalla
 *  (owner 2026-08-21): tiempo mínimo OBLIGATORIO para que el cliente VEA su
 *  usuario — si toca antes, se lo avisa y no lo deja. */
VIP.ui._landingCredsReady = function(username, ssoUrl) {
  VIP.ui._landingSsoUrl = ssoUrl || null;
  VIP.ui._landingSsoAt = Date.now();
  VIP.ui._landingCredsReadyFlag = true;
  const u = document.getElementById('landingCredsUser');
  if (u && username && u.textContent === '…') u.textContent = username;
  const wait = Math.max(0, 2000 - (Date.now() - (VIP.ui._landingCredsShownAt || 0)));
  setTimeout(function() {
    const btn = document.getElementById('landingCredsEnter');
    if (btn) btn.textContent = '🎰 ENTRAR AL CASINO';
  }, wait);
};

VIP.ui._hideLandingCreds = function() {
  const ov = document.getElementById('landingCredsOverlay');
  if (ov) ov.style.display = 'none';
};

/** ENTRAR AL CASINO: usa el SSO adelantado si sigue fresco (el código vive
 *  60s; margen 45s), si no pide uno nuevo — igual es rápido porque la PWA ya
 *  está cargada. Después abre el chat de soporte a la derecha. */
VIP.ui.landingEnterCasino = function() {
  const btn = document.getElementById('landingCredsEnter');
  if (btn && btn.textContent.indexOf('Preparando') !== -1) return; // canje en curso
  // ESPERA OBLIGATORIA de 2s: si toca antes, avisar y no dejar entrar todavía.
  const shown = Date.now() - (VIP.ui._landingCredsShownAt || 0);
  if (shown < 2000) {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✋ Esperá ' + Math.ceil((2000 - shown) / 1000) + 's — guardá tus datos';
      setTimeout(function() { if (btn.textContent.indexOf('Esperá') !== -1) btn.textContent = orig; }, 1200);
    }
    return;
  }
  clearTimeout(VIP.ui._landingAutoEnterTimer);
  VIP.state._landingCredsActive = false; // el cliente YA tocó ENTRAR
  VIP.ui._hideLandingCreds();
  const url = VIP.ui._landingSsoUrl;
  const fresh = url && (Date.now() - (VIP.ui._landingSsoAt || 0)) < 45000;
  VIP.ui._landingSsoUrl = null;
  if (fresh) VIP.ui.enterCasinoWithUrl(url); else VIP.ui.enterCasino();
  // Panel del ASISTENTE abierto a la derecha apenas el casino está arriba.
  setTimeout(function() {
    try {
      const d = document.getElementById('casinoChatDrawer');
      if (VIP.ui._casinoOpen && d && (d.style.display === 'none' || !d.style.display) && VIP.ui.openCasinoChat) {
        VIP.ui.openCasinoChat();
      }
    } catch (e) {}
  }, 500);
};

/**
 * Abre el casino en una PESTAÑA APARTE (no embebido).
 *
 * Es la salida cuando el navegador no deja que el casino funcione dentro del
 * recuadro. Al abrirse como sitio principal, sus cookies dejan de ser "de terceros"
 * y la sesión funciona normal.
 *
 * ⚠️ La pestaña se abre ANTES del fetch, dentro del gesto del usuario: si se abriera
 * después, el bloqueador de pop-ups (sobre todo en mobile) la mataría.
 * Y se pide un link NUEVO a propósito: el anterior ya lo consumió el iframe y los
 * códigos son de un solo uso.
 */
VIP.ui.openCasinoInTab = async function() {
  let win = null;
  try {
    win = window.open('', '_blank');
    if (win && win.document) {
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Entrando al casino…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;background:#12101a;color:#d4af37;font-family:system-ui,sans-serif;' +
        'font-size:18px;font-weight:700">🎰 Entrando al casino…</body>'
      );
    }
  } catch (e) { win = null; }

  try {
    const response = await fetch(`${VIP.config.API_URL}/api/platform/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VIP.state.currentToken}`
      }
    });
    const data = await response.json();

    if (response.ok && data.success && data.redirectUrl) {
      if (win && !win.closed) {
        win.location.href = data.redirectUrl;
      } else {
        // Pop-up bloqueado → se navega en la pestaña actual.
        window.location.href = data.redirectUrl;
        return;
      }
      VIP.ui.closeCasinoFrame();
      return;
    }
    if (win && !win.closed) win.close();
    VIP.ui.showToast(data.error || 'No pudimos abrirte el casino.', 'error');
  } catch (e) {
    if (win && !win.closed) win.close();
    VIP.ui.showToast('Sin conexión. Intentá de nuevo.', 'error');
  }
};

/** El casino no terminó de cargar dentro del recuadro: se ofrece abrirlo aparte. */
VIP.ui._casinoFrameStuck = function() {
  const status = document.getElementById('casinoFrameStatus');
  const frame = document.getElementById('casinoFrame');
  if (!status) return;
  // El iframe se deja visible por si en realidad terminó de cargar y sólo tardó:
  // el aviso se muestra encima, sin tapar el juego.
  status.style.display = 'flex';
  status.style.position = 'absolute';
  status.style.inset = 'auto 0 0 0';
  status.style.background = 'rgba(13,13,26,0.96)';
  status.style.padding = '18px';
  status.innerHTML =
    '<div style="color:#ffd479;font-size:15px;font-weight:700;line-height:1.45;max-width:460px;">' +
      '¿El casino no termina de cargar?</div>' +
    '<div style="color:#aaa;font-size:13px;font-weight:400;line-height:1.45;max-width:460px;">' +
      'Tu navegador puede estar bloqueando el casino por estar abierto acá adentro. ' +
      'Abrilo aparte y va a funcionar normal.</div>' +
    '<button type="button" onclick="VIP.ui.openCasinoInTab()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '↗ Abrir el casino aparte</button>' +
    '<button type="button" onclick="document.getElementById(\'casinoFrameStatus\').style.display=\'none\'" ' +
      'style="background:none;color:#888;border:none;font-size:13px;cursor:pointer;">' +
      'Seguir esperando</button>';
  if (frame) frame.style.display = 'block';
};

// (owner 2026-08-25) Removidas las acciones rápidas del pop-up VIEJO del casino
// (_casinoChip / _casinoSendQuick / casinoQuickAction + #casinoAmountRow):
// quedaron sin ningún caller al reemplazar ese pop-up por el asistente/bot
// (casinoBotGo). Código muerto verificado (0 referencias). Ver WORKLOG #234.

/** Botón 📣 Comunidad del widget del casino (#270). SIEMPRE visible (owner
 *  2026-09-09: "a veces aparecía y a veces no" — dependía de que el fetch de la
 *  config llegara, y en iPhone/Tor no siempre llega a tiempo). El href estático
 *  es /go/comunidad: el SERVER redirige al link vigente del panel en el momento
 *  del click (mismo criterio que el pill del header, #150) — no hay carrera.
 *  Cuando la config carga, chat.js deja la URL en VIP.state y acá se pisa el
 *  href con el link directo (ahorra el redirect). Nunca se oculta. */
VIP.ui._applyCasinoCommunity = function() {
  const a = document.getElementById('casinoCommunityBtn');
  if (!a) return;
  const url = (VIP.state && VIP.state.communityChannelUrl) || '';
  if (/^https?:\/\//i.test(url)) a.href = url;
};

/** Crea (una sola vez) y muestra el recuadro del casino. */
VIP.ui._showCasinoFrame = function() {
  let overlay = document.getElementById('casinoOverlay');

  // Paleta del widget en CSS (una vez): claro/oscuro colgado de `body.wa-dark`
  // — el MISMO switch del chat de soporte, así los dos modos SIEMPRE coinciden
  // (owner 2026-08-21). Las burbujas/cajas usan clases, no colores inline.
  if (!document.getElementById('casinoWidgetTheme')) {
    const st = document.createElement('style');
    st.id = 'casinoWidgetTheme';
    st.textContent =
      '#casinoBotArea{background:#ece5dd;}' +
      'body.wa-dark #casinoBotArea{background:#0b141a;}' +
      '.cwB{background:#fff;color:#111b21;box-shadow:0 1px 1px rgba(0,0,0,0.12);}' +
      'body.wa-dark .cwB{background:#202c33;color:#e9edef;box-shadow:0 1px 1px rgba(0,0,0,0.3);}' +
      '.cwTime{color:#8a939b;}body.wa-dark .cwTime{color:#8696a0;}' +
      '.cwBox{background:#f0f2f5;}body.wa-dark .cwBox{background:#111b21;}' +
      '.cwLbl{color:#6b7680;}body.wa-dark .cwLbl{color:#8696a0;}' +
      '.cwVal{color:#111b21;}body.wa-dark .cwVal{color:#e9edef;}' +
      '.cwSec{background:#fff;color:#54656f;border:1px solid #cfd6db;}' +
      'body.wa-dark .cwSec{background:#2a3942;color:#e9edef;border:1px solid #3b4a54;}' +
      '.cwSop{background:#fff;color:#128c4a;border:1.5px solid #128c4a;}' +
      'body.wa-dark .cwSop{background:#2a3942;color:#25d366;border:1.5px solid #25d366;}' +
      // #299: pestaña ACTIVA (la opción abierta se nota): borde dorado + brillo + flechita abajo.
      '.cwBar button{position:relative;transition:transform .15s,box-shadow .15s;}' +
      '.cwBar button.cwTabOn{outline:2px solid #ffd700;outline-offset:-2px;box-shadow:0 0 0 3px rgba(255,215,0,0.28),0 6px 16px rgba(0,0,0,0.35);transform:translateY(-1px);filter:brightness(1.12);}' +
      '.cwBar button.cwTabOn::after{content:"";position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-top:7px solid #ffd700;}' +
      '.cwWarn{background:#fff8e1;border:1px solid #f0c36d;color:#8a6d1a;}' +
      'body.wa-dark .cwWarn{background:#332b12;border:1px solid #6b5a22;color:#f0c36d;}' +
      '.cwIn{background:#fff;color:#111b21;border:1px solid #cfd6db;}' +
      'body.wa-dark .cwIn{background:#2a3942;color:#e9edef;border:1px solid #3b4a54;}' +
      '.cwBar{background:#f0f2f5;border-color:#e0e3e7;}' +
      'body.wa-dark .cwBar{background:#1f2c33;border-color:#0b141a;}' +
      '.cwFakeIn{background:#fff;color:#8a939b;}body.wa-dark .cwFakeIn{background:#2a3942;color:#8696a0;}' +
      '.cwFoot{background:#e9edef;}body.wa-dark .cwFoot{background:#15211f;}' +
      '.cwGrn{color:#128c4a;}body.wa-dark .cwGrn{color:#25d366;}' +
      '.cwMut{color:#8a939b;}body.wa-dark .cwMut{color:#8696a0;}' +
      '.cwUp{border:2px dashed #128c4a !important;background:#eafaf0 !important;color:#128c4a !important;}' +
      'body.wa-dark .cwUp{border-color:#25d366 !important;background:#14251c !important;color:#25d366 !important;}';
    document.head.appendChild(st);
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'casinoOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#0d0d1a;display:flex;flex-direction:column;' +
      // PWA instalada en iPhone (viewport-fit=cover): padding de safe-area arriba
      // y abajo → el casino no queda bajo el notch ni en la zona del home
      // indicator (barras oscuras discretas del color del overlay).
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    // Diseño (owner 2026-08-16): el casino se ve TAL CUAL 1girox.com (iframe a
    // pantalla completa, sin barra propia arriba). Todo el "chrome" (soporte,
    // salir, abrir aparte) vive en una BURBUJA de soporte flotante abajo a la
    // derecha que abre el chat con las acciones rápidas.
    overlay.innerHTML =
      '<div id="casinoFrameStatus" style="flex:1;display:flex;flex-direction:column;gap:14px;' +
        'align-items:center;justify-content:center;color:#d4af37;font-size:16px;font-weight:700;' +
        'text-align:center;padding:20px;">🎰 Entrando al casino…</div>' +
      // `allow` habilita pantalla completa y sonido dentro de los juegos.
      '<iframe id="casinoFrame" title="Casino" style="flex:1;width:100%;border:0;display:none;" ' +
        'allow="autoplay; fullscreen; payment"></iframe>' +
      // BURBUJA "Carga automática" (abre/cierra el widget) — logo de la marca +
      // etiqueta "⚡ CARGA AUTOMÁTICA": con el 🎧 pelado los clientes creían que
      // era el soporte propio de la página del casino. Todo vive DENTRO del
      // button para moverse junto (owner 2026-08-25, réplica tanda C).
      '<button type="button" id="casinoSupportBubble" onclick="VIP.ui.toggleCasinoChat()" ' +
        'style="position:absolute;right:16px;bottom:calc(18px + env(safe-area-inset-bottom,0px));' +
        'display:flex;flex-direction:column;align-items:center;gap:4px;padding:0;z-index:6;' +
        'background:none;border:none;cursor:pointer;user-select:none;-webkit-user-select:none;">' +
        '<span style="position:relative;display:block;width:60px;height:60px;">' +
          '<img src="/images/soporte-1girox.png" alt="Carga automática 1Girox" draggable="false" ' +
            'style="width:60px;height:60px;border-radius:50%;object-fit:cover;display:block;' +
            'border:2px solid #00e676;box-shadow:0 6px 22px rgba(0,200,83,0.55);-webkit-user-drag:none;">' +
          '<span id="casinoChatBadge" style="display:none;position:absolute;top:-3px;right:-3px;' +
            'background:#ff3b30;color:#fff;font-size:11px;font-weight:800;min-width:19px;height:19px;' +
            'border-radius:10px;line-height:19px;padding:0 4px;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></span>' +
        '</span>' +
        '<span style="display:block;background:linear-gradient(135deg,#00a844,#00e676);color:#04240f;' +
          'font-size:10px;font-weight:900;letter-spacing:0.3px;padding:3px 8px;border-radius:9px;' +
          'white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.45);">⚡ CARGA AUTOMÁTICA</span>' +
      '</button>' +
      // WIDGET de soporte flotante en la ESQUINA (owner 2026-08-17, referencia
      // Bet33): se abre "medio abierto" sobre el casino, NO parte la pantalla.
      // Ancho fijo pegado abajo a la derecha (arriba de la burbuja). El chat real
      // se muda al body al abrir y vuelve a su lugar al cerrar.
      '<div id="casinoChatDrawer" style="display:none;position:absolute;z-index:7;' +
      'right:16px;bottom:calc(88px + env(safe-area-inset-bottom,0px));' +
      'width:min(380px,calc(100vw - 24px));height:min(600px,72vh);' +
      // Sin borde (owner 2026-08-21: "sacá esas líneas blancas") — solo sombra.
      'flex-direction:column;background:#0d0d1a;border:none;' +
      'border-radius:16px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,0.6);">' +
        // #300: AGARRE para agrandar/achicar el widget (arrastrar arriba = más
        // alto, abajo = más bajo; doble toque = tamaño original). Vive arriba
        // del header; touch-action:none para que el dedo no scrollee la página.
        '<div id="casinoDrawerGrip" title="Arrastrá para agrandar o achicar" style="flex:0 0 auto;height:16px;display:flex;align-items:center;justify-content:center;' +
        'background:linear-gradient(135deg,#128c4a,#0f7a3d);cursor:ns-resize;touch-action:none;user-select:none;-webkit-user-select:none;">' +
        '<div style="width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,0.55);"></div></div>' +
        // Header verde con "EN LÍNEA" + cerrar.
        '<div style="display:flex;align-items:center;gap:10px;padding:6px 12px 10px;flex:0 0 auto;' +
        'background:linear-gradient(135deg,#128c4a,#0f7a3d);">' +
          // En modo soporte este círculo muestra la FOTO del logo (misma que
          // la cabecera del chat, configurable desde el panel); en asistente, 🎧.
          '<div id="casinoWidgetIcon" style="width:34px;height:34px;border-radius:50%;background:#0d0d1a;flex:0 0 auto;' +
          'display:flex;align-items:center;justify-content:center;font-size:16px;overflow:hidden;">' +
          '<img src="/images/soporte-1girox.png" alt="" draggable="false" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;-webkit-user-drag:none;"></div>' +
          '<div style="flex:1;min-width:0;">' +
            // El título cambia según el modo: asistente ("Cargas Automáticas")
            // o chat humano ("SOPORTE") — así el cliente diferencia (owner).
            '<div id="casinoWidgetTitle" style="color:#fff;font-weight:800;font-size:14px;">Cargas Automáticas 1Girox</div>' +
            '<div style="color:#c9f5d8;font-size:11px;display:flex;align-items:center;gap:5px;">' +
              '<span style="width:7px;height:7px;border-radius:50%;background:#7dffa8;box-shadow:0 0 6px #7dffa8;"></span>EN LÍNEA</div>' +
          '</div>' +
          // Toggle claro/oscuro: el MISMO modo que el chat de soporte (wa-dark).
          '<button type="button" id="casinoThemeBtn" onclick="VIP.ui.casinoToggleTheme()" title="Modo claro/oscuro" ' +
            'style="background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:50%;' +
            'width:28px;height:28px;font-size:14px;cursor:pointer;flex:0 0 auto;">🌙</button>' +
          '<button type="button" onclick="VIP.ui.toggleCasinoChat()" title="Cerrar" ' +
            'style="background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:50%;' +
            'width:28px;height:28px;font-size:14px;cursor:pointer;flex:0 0 auto;">✕</button>' +
        '</div>' +
        // FILA FIJA de opciones (siempre a la vista, owner 2026-08-21 ref
        // Bet33): las 3 acciones ancladas bajo el header.
        '<div class="cwBar" style="flex:0 0 auto;display:flex;gap:6px;padding:8px;">' +
          '<button type="button" id="casinoTabDeposit" onclick="VIP.ui.casinoBotGo(\'deposit\')" style="flex:1.2;background:#128c4a;' +
          'color:#fff;border:none;border-radius:9px;padding:10px 6px;font-size:12px;font-weight:800;cursor:pointer;">💳 Quiero Depositar</button>' +
          '<button type="button" id="casinoTabWithdraw" onclick="VIP.ui.casinoBotGo(\'withdraw\')" style="flex:1.2;background:#128c4a;' +
          'color:#fff;border:none;border-radius:9px;padding:10px 6px;font-size:12px;font-weight:800;cursor:pointer;">💲 Solicitar Retiro</button>' +
          '<button type="button" id="casinoSoporteBtn" class="cwSop" onclick="VIP.ui.casinoBotSupport()" style="flex:0.8;' +
          'position:relative;border-radius:9px;padding:10px 4px;font-size:12px;font-weight:800;cursor:pointer;">🎧 Soporte' +
          '<span id="casinoSoporteBadge" style="display:none;position:absolute;top:-6px;right:-6px;' +
          'background:#e53935;color:#fff;border-radius:11px;min-width:18px;height:18px;line-height:18px;' +
          'font-size:11px;font-weight:800;padding:0 4px;text-align:center;">0</span></button>' +
        '</div>' +
        // 2ª fila: 🎁 PREMIOS (hub de recompensas #254, dentro de Cargas
        // Automáticas — pedido owner 2026-09-01) + Información. El puntito rojo
        // avisa cuando hay giro o cashback reclamable.
        '<div class="cwBar" style="flex:0 0 auto;display:flex;gap:6px;padding:0 8px 8px;">' +
          '<button type="button" id="casinoRewardsBtn" onclick="VIP.ui.openRewardsHub()" style="flex:1.3;display:none;' +
          'align-items:center;justify-content:center;position:relative;background:linear-gradient(135deg,#ffd700,#ff9800);' +
          'color:#231a00;border:none;border-radius:9px;padding:8px 4px;font-size:11.5px;font-weight:900;cursor:pointer;">' +
          '🎁 PREMIOS' +
          '<span id="rwDot" style="display:none;position:absolute;top:-4px;right:-4px;width:13px;height:13px;' +
          'border-radius:50%;background:#e53935;border:2px solid #fff;box-shadow:0 0 8px rgba(229,57,53,0.9);"></span></button>' +
          '<button type="button" id="casinoTabInfo" class="cwSop" onclick="VIP.ui.casinoBotGo(\'info\')" style="flex:1;' +
          'border-radius:9px;padding:8px 4px;font-size:11.5px;font-weight:800;cursor:pointer;">ℹ️ ¿Cómo funciona?</button>' +
        '</div>' +
        // 3ª fila: 📣 COMUNIDAD de Telegram (#270). En el formato casino el pill
        // celeste del header y el ítem del menú ☰ quedan tapados por el overlay,
        // así que el link del canal (panel → Comandos → "Comunidad / Canal de
        // Telegram") se muestra ACÁ. SIEMPRE visible: href estático /go/comunidad
        // (redirect del server al link vigente) y chat.js lo pisa con el directo.
        '<div class="cwBar" id="casinoCommunityRow" style="flex:0 0 auto;display:flex;padding:0 8px 8px;">' +
          '<a id="casinoCommunityBtn" href="/go/comunidad" target="_blank" rel="noopener noreferrer" ' +
          'title="Unite a la Comunidad de Telegram" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;' +
          'background:linear-gradient(135deg,#37b2f0,#1e96d6);color:#fff;text-decoration:none;border-radius:9px;' +
          'padding:8px 6px;font-size:11.5px;font-weight:900;box-shadow:0 0 10px rgba(42,171,238,0.45);">' +
          '📣 Unite a la Comunidad de Telegram</a>' +
        '</div>' +
        // ASISTENTE (bot) — modo DEFAULT del widget: flujo guiado de depósito
        // (datos + copiar + comprobante) y retiro EN el panel. Look tipo
        // WhatsApp (claro u oscuro según wa-dark). Chat humano = FALLBACK.
        '<div id="casinoBotArea" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
        'padding:10px;display:flex;flex-direction:column;gap:8px;"></div>' +
        // Chat EN VIVO (solo soporte): acá se MUDA el chat real al activarlo.
        '<div id="casinoChatDrawerBody" style="flex:1;display:none;flex-direction:column;min-height:0;"></div>' +
        // SIN barra de mensaje en el asistente (owner 2026-08-21): derivaba a
        // soporte con un toque de más — la ÚNICA vía a soporte es el botón 🎧.
        // En modo soporte el chat real trae su barra de escribir verdadera.
        // Barrita inferior mínima. SIN "Salir del casino" ni "Casino aparte"
        // (owner 2026-08-21) — el abrir-aparte queda solo en el recuadro de
        // error del casino (openCasinoInTab sigue existiendo para eso).
        '<div class="cwFoot" style="flex:0 0 auto;display:flex;gap:14px;justify-content:center;padding:4px;">' +
          '<button type="button" class="cwGrn" onclick="VIP.ui.casinoBotGo(\'home\')" style="background:none;border:none;' +
          'font-size:10.5px;cursor:pointer;font-weight:700;">🤖 Asistente</button>' +
          // #290: los datos de ingreso SIEMPRE a mano (antes solo salían al inicio
          // del asistente y se perdían al pedir la carga).
          '<button type="button" class="cwGrn" onclick="VIP.ui.casinoBotGo(\'creds\')" style="background:none;border:none;' +
          'font-size:10.5px;cursor:pointer;font-weight:700;">🪪 Mis datos</button>' +
          // #318: Mis referidos SIEMPRE a mano (el banner del inicio desaparece al ir a depositar).
          '<button type="button" class="cwGrn" onclick="VIP.ui.openReferralModal()" style="background:none;border:none;' +
          'font-size:10.5px;cursor:pointer;font-weight:700;">🤝 Mis referidos</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Burbuja ARRASTRABLE con imán al borde (owner 2026-08-25): el cliente la
    // puede mover si le tapa el juego. Se engancha UNA vez (el overlay se cachea).
    try { VIP.ui._makeBubbleDraggable(); } catch (e) {}
    // Si la config de Comunidad ya llegó antes de crear el widget, pintarla ahora.
    try { VIP.ui._applyCasinoCommunity(); } catch (e) {}

    // Cuando el casino termina de cargar, se esconde el "cargando" y se muestra el juego.
    const frame = overlay.querySelector('#casinoFrame');
    frame.addEventListener('load', function() {
      if (!frame.src) return; // el load inicial del iframe vacío no cuenta
      if (VIP.ui._casinoLogoutLoading) return; // el load de la URL de logout tampoco (#252)
      const status = document.getElementById('casinoFrameStatus');
      if (status) status.style.display = 'none';
      frame.style.display = 'block';
      // El casino cargó → se cancelan TODOS los avisos (watchdog + escape) y se
      // esconde la barrita si ya estaba (owner 2026-08-21: "si abre que quede
      // abierto sin ningún cartel para no marear"). El aviso "abrir aparte"
      // queda SOLO para el caso en que el iframe nunca carga (conexión al
      // casino bloqueada) — no para el que le abre bien.
      VIP.ui._casinoFrameLoaded = true;
      clearTimeout(VIP.ui._casinoWatchdog);
      clearTimeout(VIP.ui._casinoEscapeTimer);
      VIP.ui._hideCasinoEscapeBar();
    });
  }

  // Reset al abrir (por si venía de un intento anterior que falló).
  const frame = overlay.querySelector('#casinoFrame');
  const status = overlay.querySelector('#casinoFrameStatus');
  if (frame) { frame.src = ''; frame.style.display = 'none'; }
  if (status) { status.style.display = 'flex'; status.textContent = '🎰 Entrando al casino…'; }
  VIP.ui._hideCasinoEscapeBar();
  clearTimeout(VIP.ui._casinoEscapeTimer);

  overlay.style.display = 'flex';
  // El casino ya tapa todo → fuera el splash de arranque (#253).
  try { document.documentElement.classList.remove('casino-boot'); } catch (e) {}
  // Bloquea el scroll del fondo mientras el casino está abierto.
  document.body.style.overflow = 'hidden';
  VIP.ui._casinoOpen = true;
  // Hub de premios (#254): traer el resumen (bienvenida/diaria/cashback) y
  // prender el botón + puntito. Fire-and-forget.
  try { VIP.ui._refreshRewards(); } catch (e) {}

  // Badge de mensajes sin leer mientras juega: observa el listado real del chat
  // (chat.js sigue appendeando ahí aunque el casino lo tape) y cuenta lo que
  // llega con el panel de chat CERRADO. Vive para siempre; los guards de arriba
  // lo apagan fuera del casino.
  if (!VIP.ui._casinoChatObserver && window.MutationObserver) {
    const msgs = document.getElementById('chatMessages');
    if (msgs) {
      VIP.ui._casinoChatObserver = new MutationObserver(function(muts) {
        if (!VIP.ui._casinoOpen) return;
        // Con el asistente (bot) el chat real puede NO estar a la vista aunque
        // el panel esté abierto — el badge solo se calla si el chat vivo está
        // montado (modo soporte, _casinoChatPh seteado).
        const drawer = document.getElementById('casinoChatDrawer');
        const supportOnView = drawer && drawer.style.display !== 'none' && VIP.ui._casinoChatPh;
        if (supportOnView) return;
        // Contar SOLO los mensajes ENTRANTES (de soporte). Los del propio
        // usuario tienen clase `.message.agente`; los de soporte, `.usuario`.
        let incoming = 0;
        for (let i = 0; i < muts.length; i++) {
          for (let j = 0; j < muts[i].addedNodes.length; j++) {
            const node = muts[i].addedNodes[j];
            if (node && node.querySelector) {
              // Solo mensajes de SOPORTE HUMANO: entrantes (.usuario) que NO
              // sean automáticos del sistema (.msg-auto) — así la bienvenida y
              // el mensaje de credenciales NO disparan "Soporte te respondió".
              const m = node.querySelector('.message.usuario:not(.msg-auto)') ||
                (node.classList && node.classList.contains('usuario') && !node.classList.contains('msg-auto') ? node : null);
              if (m) incoming++;
            }
          }
        }
        if (!incoming) return;
        // Badge genérico en la burbuja + badge y aviso de SOPORTE (owner
        // 2026-08-22): que el usuario sepa que el sonido vino de Soporte.
        VIP.ui._casinoChatUnread = (VIP.ui._casinoChatUnread || 0) + incoming;
        const badge = document.getElementById('casinoChatBadge');
        if (badge) {
          badge.textContent = VIP.ui._casinoChatUnread > 9 ? '9+' : String(VIP.ui._casinoChatUnread);
          badge.style.display = 'inline-block';
        }
        VIP.ui._notifySupportReply(incoming);
      });
      VIP.ui._casinoChatObserver.observe(msgs, { childList: true });
    }
  }
  VIP.ui._casinoChatUnread = 0;

  // El panel del asistente SIEMPRE abierto al entrar al casino (owner
  // 2026-08-21) — el cliente puede cerrarlo con la ✕ si molesta.
  setTimeout(function() {
    try { if (VIP.ui._casinoOpen && VIP.ui.openCasinoChat) VIP.ui.openCasinoChat(); } catch (e) {}
  }, 250);
};

/** Abre/cierra el panel SOBRE el casino (el juego no se corta). Al abrir
 *  arranca en modo ASISTENTE (bot); el chat vivo solo aparece vía soporte. */
VIP.ui.toggleCasinoChat = function() {
  // Si venía de ARRASTRAR la burbuja, el click sintético que sigue al soltar NO
  // debe abrir/cerrar el panel (owner 2026-08-25).
  if (VIP.ui._bubbleWasDragged) return;
  const drawer = document.getElementById('casinoChatDrawer');
  if (!drawer) return;
  if (drawer.style.display === 'none' || !drawer.style.display) VIP.ui.openCasinoChat();
  else { VIP.ui.closeCasinoChat(); VIP.ui._showBubbleDragHintOnce(); }
};

/**
 * Hace la burbuja del casino ARRASTRABLE con imán al borde (owner 2026-08-25).
 * Pointer events (mouse + touch), umbral de 8px para separar TOQUE de ARRASTRE,
 * `setPointerCapture` + `touch-action:none` (no scrollea la página mientras se
 * arrastra). Al soltar se pega al borde izq/der más cercano y guarda lado + alto
 * en localStorage. Setea `_bubbleWasDragged` para que el click sintético del
 * pointerup NO abra/cierre el panel; se limpia a los ~400ms. Usa
 * getBoundingClientRect: la burbuja es una columna logo+etiqueta SIN tamaño fijo.
 */
VIP.ui._makeBubbleDraggable = function() {
  const bubble = document.getElementById('casinoSupportBubble');
  if (!bubble || bubble._dragArmed) return;
  bubble._dragArmed = true;
  bubble.style.touchAction = 'none';

  // Restaurar posición guardada (lado + alto), si ya la movió antes.
  VIP.ui._applyBubblePosition();

  const THRESH = 8; // px para pasar de "toque" a "arrastre"
  let startX = 0, startY = 0, origLeft = 0, origTop = 0, dragging = false, moved = false, pid = null;

  function onDown(e) {
    if (e.button != null && e.button !== 0) return; // solo botón primario
    const r = bubble.getBoundingClientRect();
    dragging = true; moved = false;
    origLeft = r.left; origTop = r.top;
    startX = e.clientX; startY = e.clientY;
    // Fijar por left/top absolutos desde el rect actual (deja right/bottom).
    bubble.style.left = r.left + 'px';
    bubble.style.top = r.top + 'px';
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
    pid = e.pointerId;
    try { if (pid != null && bubble.setPointerCapture) bubble.setPointerCapture(pid); } catch (_) {}
    // Con setPointerCapture los eventos del puntero llegan SIEMPRE a la burbuja,
    // aunque el dedo/mouse salga de ella → escuchamos en la burbuja.
    bubble.addEventListener('pointermove', onMove, { passive: false });
    bubble.addEventListener('pointerup', onUp);
    bubble.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) + Math.abs(dy)) > THRESH) { moved = true; VIP.ui._bubbleWasDragged = true; }
    if (!moved) return;
    e.preventDefault();
    const bw = bubble.offsetWidth || 64, bh = bubble.offsetHeight || 84;
    let nl = origLeft + dx, nt = origTop + dy;
    nl = Math.max(6, Math.min(window.innerWidth - bw - 6, nl));
    nt = Math.max(6, Math.min(window.innerHeight - bh - 6, nt));
    bubble.style.left = nl + 'px';
    bubble.style.top = nt + 'px';
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    bubble.removeEventListener('pointermove', onMove);
    bubble.removeEventListener('pointerup', onUp);
    bubble.removeEventListener('pointercancel', onUp);
    try { if (pid != null && bubble.releasePointerCapture) bubble.releasePointerCapture(pid); } catch (_) {}
    pid = null;
    if (!moved) { VIP.ui._bubbleWasDragged = false; return; }
    // Imán al borde horizontal más cercano; el alto queda donde lo soltó.
    const r = bubble.getBoundingClientRect();
    const side = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
    const topPx = Math.max(6, Math.min(window.innerHeight - r.height - 6, r.top));
    VIP.ui._bubbleSide = side;
    VIP.ui._bubbleTop = topPx;
    try {
      localStorage.setItem('casinoBubbleSide', side);
      localStorage.setItem('casinoBubbleTop', String(Math.round(topPx)));
    } catch (_) {}
    VIP.ui._applyBubblePosition();
    // Limpiar el flag DESPUÉS del click sintético que dispara el pointerup.
    setTimeout(function() { VIP.ui._bubbleWasDragged = false; }, 400);
  }

  bubble.addEventListener('pointerdown', onDown);
};

/** Aplica a la burbuja el lado (imán) y alto guardados; si nunca la movió, deja
 *  el default (abajo a la derecha, del CSS inline). Clampa el alto al viewport. */
VIP.ui._applyBubblePosition = function() {
  const bubble = document.getElementById('casinoSupportBubble');
  if (!bubble) return;
  let side = VIP.ui._bubbleSide, top = VIP.ui._bubbleTop;
  try {
    if (side == null) side = localStorage.getItem('casinoBubbleSide') || null;
    if (top == null) { const t = localStorage.getItem('casinoBubbleTop'); if (t != null && t !== '') top = parseInt(t, 10); }
  } catch (_) {}
  if (!side) return; // nunca la movió → queda en su posición default
  VIP.ui._bubbleSide = side;
  const bh = bubble.offsetHeight || 84;
  if (top == null || isNaN(top)) top = window.innerHeight - bh - 24;
  top = Math.max(6, Math.min(window.innerHeight - bh - 6, top));
  VIP.ui._bubbleTop = top;
  bubble.style.top = top + 'px';
  bubble.style.bottom = 'auto';
  if (side === 'left') { bubble.style.left = '16px'; bubble.style.right = 'auto'; }
  else { bubble.style.right = '16px'; bubble.style.left = 'auto'; }
};

/**
 * Pista de arrastre (una vez por dispositivo): al PRIMER cierre del widget se
 * muestra un globito junto a la burbuja avisando que se puede arrastrar — sin
 * esto nadie descubre que se mueve. El guard con localStorage va ANTES de crear
 * nada; si localStorage no está (modo privado raro), no se muestra y listo.
 */
VIP.ui._showBubbleDragHintOnce = function() {
  try {
    if (localStorage.getItem('casinoBubbleDragHint')) return;
    localStorage.setItem('casinoBubbleDragHint', '1');
  } catch (e) { return; }
  const overlay = document.getElementById('casinoOverlay');
  const b = document.getElementById('casinoSupportBubble');
  if (!overlay || !b) return;
  const r = b.getBoundingClientRect();
  const hint = document.createElement('div');
  hint.textContent = '✋ ¿Te tapa el juego? Mantené apretado y arrastrá la burbuja a donde quieras';
  hint.style.cssText =
    'position:absolute;max-width:230px;background:rgba(13,13,26,0.95);color:#ffd700;' +
    'border:1px solid rgba(212,175,55,0.6);border-radius:12px;padding:9px 12px;' +
    'font-size:12px;font-weight:700;line-height:1.35;z-index:8;' +
    'box-shadow:0 8px 30px rgba(0,0,0,0.6);transition:opacity 0.6s;';
  // Del mismo lado que la burbuja; ARRIBA de ella si está en la mitad inferior,
  // ABAJO si está en la mitad superior (así no se va de pantalla).
  if ((r.left + r.width / 2) < window.innerWidth / 2) hint.style.left = '12px';
  else hint.style.right = '12px';
  if ((r.top + r.height / 2) >= window.innerHeight / 2) hint.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  else hint.style.top = (r.bottom + 8) + 'px';
  overlay.appendChild(hint);
  setTimeout(function() { hint.style.opacity = '0'; }, 6000);
  setTimeout(function() { try { hint.remove(); } catch (e) {} }, 6800);
};

/** Abre el panel en modo asistente (o como estaba si el soporte quedó activo). */
// #300: redimensionar el widget arrastrando el agarre de arriba. Alto guardado
// en localStorage (vip_widget_h) y re-aplicado al abrir. Límites: 260px …
// alto de la pantalla − 40px. Doble toque en el agarre = volver al default.
VIP.ui._drawerMaxH = function() { return Math.max(260, window.innerHeight - 40); };
VIP.ui._applyDrawerHeight = function(drawer) {
  let h = 0;
  try { h = parseInt(localStorage.getItem('vip_widget_h') || '0', 10) || 0; } catch (e) {}
  if (h > 0) drawer.style.height = Math.min(VIP.ui._drawerMaxH(), Math.max(260, h)) + 'px';
};
VIP.ui._initDrawerResize = function(drawer) {
  const grip = document.getElementById('casinoDrawerGrip');
  if (!grip || grip.dataset.rs) return;
  grip.dataset.rs = '1';
  let startY = 0, startH = 0, active = false;
  const onMove = function(e) {
    if (!active) return;
    const y = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : startY);
    const h = Math.min(VIP.ui._drawerMaxH(), Math.max(260, startH + (startY - y)));
    drawer.style.height = h + 'px';
    if (e.cancelable) e.preventDefault();
  };
  const onEnd = function() {
    if (!active) return;
    active = false;
    try { localStorage.setItem('vip_widget_h', String(drawer.offsetHeight)); } catch (e) {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
  };
  grip.addEventListener('pointerdown', function(e) {
    active = true; startY = e.clientY; startH = drawer.offsetHeight;
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    if (e.cancelable) e.preventDefault();
  });
  grip.addEventListener('dblclick', function() {
    drawer.style.height = '';
    try { localStorage.removeItem('vip_widget_h'); } catch (e) {}
  });
};

VIP.ui.openCasinoChat = function() {
  const drawer = document.getElementById('casinoChatDrawer');
  if (!drawer) return;
  drawer.style.display = 'flex';
  VIP.ui._initDrawerResize(drawer); // #300
  VIP.ui._applyDrawerHeight(drawer);
  // Anclar el panel al MISMO CUADRANTE que la burbuja (lado izq/der + mitad
  // arriba/abajo) para que abra "desde" donde está, y OCULTAR la burbuja mientras
  // el panel está abierto → el chat nunca la tapa (se cierra con la ✕). Se lee el
  // rect real: sirve arrastrada o en su lugar default (owner 2026-08-25).
  const _bubble = document.getElementById('casinoSupportBubble');
  let _side = VIP.ui._bubbleSide || 'right', _bottom = true;
  if (_bubble) {
    const br = _bubble.getBoundingClientRect();
    if (br.width || br.height) {
      _side = (br.left + br.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
      _bottom = (br.top + br.height / 2) >= window.innerHeight / 2;
    }
    _bubble.style.visibility = 'hidden';
  }
  if (_side === 'left') { drawer.style.left = '16px'; drawer.style.right = 'auto'; }
  else { drawer.style.right = '16px'; drawer.style.left = 'auto'; }
  if (_bottom) { drawer.style.bottom = 'calc(16px + env(safe-area-inset-bottom,0px))'; drawer.style.top = 'auto'; }
  else { drawer.style.top = 'calc(16px + env(safe-area-inset-top,0px))'; drawer.style.bottom = 'auto'; }
  VIP.ui._casinoChatUnread = 0;
  const badge = document.getElementById('casinoChatBadge');
  if (badge) badge.style.display = 'none';
  VIP.ui._syncCasinoThemeBtn();
  // Primera apertura → home del bot. Si el chat vivo quedó montado (soporte),
  // se respeta; si no, se muestra el estado del bot tal como quedó.
  if (!VIP.ui._casinoChatPh && !VIP.ui._botStarted) {
    VIP.ui._botStarted = true;
    VIP.ui.casinoBotGo('home');
  }
};

VIP.ui.closeCasinoChat = function() {
  // Si el chat vivo estaba montado, devolver los nodos a la página SIEMPRE.
  if (VIP.ui._casinoChatPh) VIP.ui._casinoChatRestoreNodes();
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) drawer.style.display = 'none';
  // La burbuja vuelve a aparecer (se ocultó al abrir el panel).
  const bubble = document.getElementById('casinoSupportBubble');
  if (bubble) bubble.style.visibility = 'visible';
};

/** Muda el chat REAL (cabecera+mensajes+barra de escribir) adentro del panel.
 *  Mover los nodos conserva ids, listeners y el socket: es EL MISMO chat, no
 *  una copia — por eso el agente lo ve en su bandeja de siempre. */
VIP.ui._casinoChatMount = function() {
  const drawer = document.getElementById('casinoChatDrawer');
  const body = document.getElementById('casinoChatDrawerBody');
  const cc = document.querySelector('.chat-container');
  const cic = document.querySelector('.chat-input-container');
  if (!drawer || !body || !cc || !cic) return;
  // Ya montado (ej. Soporte tocado dos veces, o Soporte estando en carga
  // manual #295): no volver a mover los nodos — se perderían los marcadores
  // y el chat no volvería a su lugar. Solo refrescar título/estado.
  if (VIP.ui._casinoChatPh) {
    const t0 = document.getElementById('casinoWidgetTitle'); if (t0) t0.textContent = 'SOPORTE 1Girox';
    const mb0 = document.getElementById('casinoManualBar'); if (mb0) mb0.remove();
    drawer.style.display = 'flex'; body.style.display = 'flex';
    return;
  }
  // Modo SOPORTE: se esconde el asistente (y su barra de mensaje de mentira —
  // el chat real trae la de verdad) y se muestra el chat real. El título del
  // header pasa a SOPORTE para diferenciarlo de las cargas automáticas.
  const botArea = document.getElementById('casinoBotArea');
  if (botArea) botArea.style.display = 'none';
  const fakeInput = document.getElementById('casinoBotFakeInput');
  if (fakeInput) fakeInput.style.display = 'none';
  const title = document.getElementById('casinoWidgetTitle');
  if (title) title.textContent = 'SOPORTE 1Girox';
  // Foto del logo 1G al lado del nombre (la misma del avatar del chat, que
  // chat.js pisa con el logo cargado en el panel; fallback al default 1G).
  const icon = document.getElementById('casinoWidgetIcon');
  if (icon) {
    let logoSrc = '/images/soporte-1girox.png';
    try {
      const av = document.getElementById('chatTopbarAvatar');
      if (av && av.src) logoSrc = av.src;
    } catch (e) {}
    icon.innerHTML = '<img src="' + logoSrc + '" alt="Soporte 1Girox" ' +
      'style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;">';
  }
  body.style.display = 'flex';
  // Marcadores invisibles para devolver cada bloque EXACTAMENTE donde estaba.
  const ph1 = document.createElement('div'); ph1.style.display = 'none';
  const ph2 = document.createElement('div'); ph2.style.display = 'none';
  cc.parentNode.insertBefore(ph1, cc);
  cic.parentNode.insertBefore(ph2, cic);
  body.appendChild(cc);
  body.appendChild(cic);
  // Dentro del panel el chat se COMPACTA (owner 2026-08-15):
  // 1. Se oculta la cabecera "Cargas 1Girox" (avatar/en línea/🔥) — el panel ya
  //    tiene su propio título y así se ven más mensajes en el 50% de alto.
  // 2. min-height:0 pisa el piso de 170px de .chat-container: con el panel
  //    corto, ese piso empujaba la barra de escribir fuera de la vista y el
  //    chat "no bajaba del todo".
  const tb = cc.querySelector('.chat-topbar');
  if (tb) tb.style.display = 'none';
  const prevMinHeight = cc.style.minHeight;
  cc.style.minHeight = '0';
  VIP.ui._casinoChatPh = { ph1: ph1, ph2: ph2, cc: cc, cic: cic, tb: tb, prevMinHeight: prevMinHeight };
  drawer.style.display = 'flex';
  // Visto: badge a cero y mensajes al final (tras el reflow del layout nuevo).
  VIP.ui._casinoChatUnread = 0;
  const badge = document.getElementById('casinoChatBadge');
  if (badge) badge.style.display = 'none';
  requestAnimationFrame(function() {
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
};

/** Devuelve el chat real a su lugar de la página (sin tocar el panel) y
 *  vuelve a dejar visible el asistente. */
VIP.ui._casinoChatRestoreNodes = function() {
  const s = VIP.ui._casinoChatPh;
  if (s) {
    // Deshacer la compactación ANTES de devolverlo: en la página el chat
    // vuelve con su cabecera y su piso de altura de siempre.
    if (s.tb) s.tb.style.display = '';
    if (s.cc) s.cc.style.minHeight = s.prevMinHeight || '';
  }
  if (s && s.ph1 && s.ph1.parentNode) { s.ph1.parentNode.insertBefore(s.cc, s.ph1); s.ph1.remove(); }
  if (s && s.ph2 && s.ph2.parentNode) { s.ph2.parentNode.insertBefore(s.cic, s.ph2); s.ph2.remove(); }
  VIP.ui._casinoChatPh = null;
  { const mb = document.getElementById('casinoManualBar'); if (mb) mb.remove(); } // #295
  const body = document.getElementById('casinoChatDrawerBody');
  if (body) body.style.display = 'none';
  const botArea = document.getElementById('casinoBotArea');
  if (botArea) botArea.style.display = 'flex';
  const fakeInput = document.getElementById('casinoBotFakeInput');
  if (fakeInput) fakeInput.style.display = 'flex';
  const title = document.getElementById('casinoWidgetTitle');
  if (title) title.textContent = 'Cargas Automáticas 1Girox';
  const icon = document.getElementById('casinoWidgetIcon');
  if (icon) icon.innerHTML = '<img src="/images/soporte-1girox.png" alt="" draggable="false" ' +
    'style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;-webkit-user-drag:none;">';
};

/** Compat: devuelve el chat Y esconde el panel (lo usa closeCasinoFrame). */
VIP.ui._casinoChatUnmount = function() {
  VIP.ui._casinoChatRestoreNodes();
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) drawer.style.display = 'none';
  const bubble = document.getElementById('casinoSupportBubble');
  if (bubble) bubble.style.visibility = 'visible';
};

// ============================================================
// ASISTENTE del casino (owner 2026-08-21, referencia Bet33): flujo GUIADO en
// vez de chat en vivo. Depósito: datos bancarios con Copiar → "Ya hice la
// transferencia" → subir comprobante → lo verifica la IA y la auto-carga
// acredita sola (pipeline existente). Retiro: formulario self-service
// existente. El chat humano queda SOLO en "Hablar con soporte" o si algo
// de la automatización falla.
// ============================================================

/** Hora corta para las burbujas (estilo WhatsApp). */
VIP.ui._botTime = function() {
  try {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch (e) { return ''; }
};

/** Burbuja del bot (look WhatsApp; claro u oscuro según `body.wa-dark` — los
 *  colores viven en las clases cw* del <style> del widget). Devuelve el nodo. */
VIP.ui._botMsg = function(html) {
  const area = document.getElementById('casinoBotArea');
  if (!area) return null;
  const b = document.createElement('div');
  b.className = 'cwB';
  b.style.cssText = 'border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5;';
  b.innerHTML = html +
    '<div class="cwTime" style="text-align:right;font-size:10px;margin-top:4px;">' + VIP.ui._botTime() + '</div>';
  area.appendChild(b);
  area.scrollTop = area.scrollHeight;
  return b;
};

VIP.ui._botBtn = function(label, onclick, primary) {
  const cls = primary ? '' : ' class="cwSec"';
  const style = primary ? 'background:#128c4a;color:#fff;border:none;' : '';
  return '<button type="button"' + cls + ' onclick="' + onclick + '" style="' + style +
    'border-radius:10px;padding:11px 12px;font-size:13px;font-weight:800;cursor:pointer;flex:1;min-width:0;' +
    'box-shadow:0 1px 1px rgba(0,0,0,0.08);">' + label + '</button>';
};

VIP.ui._botRow = function(btnsHtml) {
  const area = document.getElementById('casinoBotArea');
  if (!area) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  row.innerHTML = btnsHtml;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
};

/** Recuadro "TUS DATOS DE INGRESO" del inicio del asistente (#255). Renderiza
 *  al toque con lo que se sabe y completa la clave cuando responde el server
 *  (cacheado por sesión). Copiar con un toque. */
// Pinta (o repinta) el cuerpo del recuadro de datos. Expuesto para que auth.js
// lo llame al cambiar la contraseña (#291): la clave nueva aparece al instante.
VIP.ui._paintCredsBox = function() {
  const u = (VIP.state.currentUser && VIP.state.currentUser.username) || '';
  const el = document.getElementById('credsBoxBody');
  if (!el || !u) return;
  const pass = VIP.state.sessionPassword || VIP.ui._credsDefaultPass || null;
  const pill = function(v) {
    return '<b style="font-size:15px;letter-spacing:0.4px;color:#ffd700;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.35);' +
      'border-radius:8px;padding:2px 8px;">' + _wrEsc(v) + '</b>';
  };
  const copy = function(v) {
    return '<button type="button" onclick="VIP.ui._copyCred(\'' + _wrEsc(v) + '\')" ' +
      'style="background:linear-gradient(135deg,#f5d16a,#c99a2e);color:#1a1200;border:none;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:900;cursor:pointer;">📋 copiar</button>';
  };
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;">' +
      '<span class="cwLbl" style="font-size:12px;">👤 Usuario:</span>' + pill(u) + copy(u) +
    '</div>' +
    (pass
      ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
          '<span class="cwLbl" style="font-size:12px;">🔑 Clave:</span>' + pill(pass) + copy(pass) +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;flex-wrap:wrap;">' +
          '<span class="cwLbl" style="font-size:10.5px;">Guardalos para volver a entrar. 🙌</span>' +
          '<button type="button" onclick="VIP.ui._credsChangePwd()" style="background:none;border:1px solid rgba(212,175,55,0.5);color:#ffd700;' +
            'border-radius:8px;padding:4px 9px;font-size:11px;font-weight:800;cursor:pointer;">🔑 Cambiar contraseña</button>' +
        '</div>'
      : '<div style="margin-top:4px;"><span class="cwLbl" style="font-size:12px;">🔑 Clave:</span> ' +
          '<span style="font-size:12px;">la que elegiste al crear tu cuenta. ¿La olvidaste? Tocá <b>🎧 Soporte</b> y te la cambiamos al toque.</span>' +
          '<div style="margin-top:6px;"><button type="button" onclick="VIP.ui._credsChangePwd()" style="background:none;border:1px solid rgba(212,175,55,0.5);color:#ffd700;' +
            'border-radius:8px;padding:4px 9px;font-size:11px;font-weight:800;cursor:pointer;">🔑 Cambiar contraseña</button></div></div>');
};
// Cambiar contraseña desde "Mis datos" (#291): mismo modal que Configuración,
// en modo voluntario. El modal se pone por ENCIMA del casino (z 99999) para
// que no quede tapado.
VIP.ui._credsChangePwd = function() {
  try {
    VIP.state.passwordChangePending = false;
    if (VIP.auth && typeof VIP.auth.prepareChangePasswordModal === 'function') VIP.auth.prepareChangePasswordModal();
    const m = document.getElementById('changePasswordModal');
    if (m) m.style.zIndex = '2147483005';
    VIP.ui.showModal('changePasswordModal');
  } catch (e) {}
};
VIP.ui._renderCredsBox = function() {
  const u = (VIP.state.currentUser && VIP.state.currentUser.username) || '';
  if (!u) return;
  const paint = VIP.ui._paintCredsBox;
  // Recuadro DORADO (#291, owner: "está muy apagado") — mismo tamaño, más presencia.
  VIP.ui._botMsg('<div style="margin:-4px -6px;padding:8px 10px;border-radius:10px;border:1px solid rgba(212,175,55,0.55);' +
    'background:linear-gradient(135deg,rgba(212,175,55,0.16),rgba(212,175,55,0.04));box-shadow:0 0 14px rgba(212,175,55,0.15) inset;">' +
    '<b style="font-size:13px;color:#ffd700;letter-spacing:.3px;">🪪 TUS DATOS DE INGRESO</b><div id="credsBoxBody"></div></div>');
  paint();
  // Completar la clave default desde el server (una vez por sesión).
  if (VIP.ui._credsFetched) return;
  VIP.ui._credsFetched = true;
  fetch(`${VIP.config.API_URL}/api/users/my-credentials`, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    if (d && d.defaultPassword) { VIP.ui._credsDefaultPass = d.defaultPassword; paint(); }
  }).catch(function() {});
};
VIP.ui._copyCred = function(txt) {
  const done = function() { VIP.ui.showToast('Copiado ✔', 'success'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done).catch(function() {}); return; }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
  } catch (e) {}
};

/** Estados del asistente. */
// ============================================================
// #295: DOS FORMAS DE CARGAR (owner 2026-09-24). 'auto' = carga automática
// (CBU + comprobante en el asistente, acredita sola en segundos — lo que
// distingue a esta página). 'manual' = carga CON UN AGENTE: es todo por chat,
// el cliente manda la captura y el agente le carga (si la agarra hgcash/IA se
// acredita sola igual). El cliente elige la primera vez, y puede cambiar de
// una a otra cuando quiera (link en la tarjeta de carga / barra del chat /
// chip del inicio). Se recuerda en localStorage + en el User (depositMode).
// ============================================================
VIP.ui._depositMode = function() {
  let m = null;
  try { m = localStorage.getItem('vip_deposit_mode'); } catch (e) {}
  if (m !== 'auto' && m !== 'manual') m = (VIP.ui._rwSummary && VIP.ui._rwSummary.depositMode) || null;
  return (m === 'auto' || m === 'manual') ? m : null;
};
VIP.ui.setDepositMode = function(mode, thenGo) {
  if (mode !== 'auto' && mode !== 'manual') return;
  try { localStorage.setItem('vip_deposit_mode', mode); } catch (e) {}
  if (VIP.ui._rwSummary) VIP.ui._rwSummary.depositMode = mode;
  try {
    fetch(`${VIP.config.API_URL}/api/user/deposit-mode`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode })
    }).catch(function() {});
  } catch (e) {}
  VIP.ui.showToast(mode === 'auto' ? '⚡ Carga automática activada' : '💬 Carga con un agente activada', 'success');
  if (thenGo) {
    // Para que la tarjeta de carga se vuelva a armar con el modo nuevo.
    const old = document.getElementById('botDepositCard'); if (old) old.id = '';
    VIP.ui._botDepositAt = 0;
    VIP.ui.casinoBotGo('deposit');
  }
};
VIP.ui._depositModeChip = function() {
  const m = VIP.ui._depositMode();
  const txt = m === 'manual' ? '💬 Con un agente' : (m === 'auto' ? '⚡ Automática' : '— sin elegir');
  return '<div class="cwBox" style="border-radius:9px;padding:7px 10px;margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;">' +
    '<span class="cwLbl" style="font-size:10.5px;font-weight:700;letter-spacing:.4px;">MODO DE CARGA</span>' +
    '<b style="flex:1;">' + txt + '</b>' +
    '<span class="cwGrn" onclick="VIP.ui.casinoBotGo(\'deposit-mode\')" style="font-weight:800;cursor:pointer;text-decoration:underline;">Cambiar</span></div>';
};
/** Carga MANUAL: abre el chat real con el agente (misma mecánica que Soporte)
 *  y avisa al server (mensaje /sys_carga_manual + nota al panel). */
VIP.ui.casinoBotManualDeposit = function() {
  VIP.ui._clearSupportUnread();
  VIP.ui._casinoChatMount();
  VIP.ui._setActiveTab('deposit'); // #299
  const title = document.getElementById('casinoWidgetTitle');
  if (title) title.textContent = 'Carga con un agente';
  // Barra fina arriba del chat: modo actual + pasar a automática en 1 toque.
  const body = document.getElementById('casinoChatDrawerBody');
  if (body && !document.getElementById('casinoManualBar')) {
    const bar = document.createElement('div');
    bar.id = 'casinoManualBar';
    bar.className = 'cwBox';
    bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12px;border-radius:0;';
    bar.innerHTML = '<span style="flex:1;"><b>💬 Carga con un agente</b> · mandá la captura acá y te cargan</span>' +
      '<button type="button" onclick="VIP.ui.setDepositMode(\'auto\', true)" class="cwSec" style="border-radius:8px;padding:6px 9px;font-size:11.5px;font-weight:800;cursor:pointer;flex:0 0 auto;">⚡ Automática</button>';
    body.insertBefore(bar, body.firstChild);
  }
  try {
    fetch(`${VIP.config.API_URL}/api/deposit/manual-start`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).catch(function() {});
  } catch (e) {}
  setTimeout(function() {
    try { const msgs = document.getElementById('chatMessages'); if (msgs) msgs.scrollTop = msgs.scrollHeight; } catch (e) {}
  }, 600);
};

// #299: marca la opción abierta en la barra (deposit / withdraw / support /
// info / null). Cada opción es una "pestaña": su contenido reemplaza al anterior.
VIP.ui._setActiveTab = function(key) {
  const map = { deposit: 'casinoTabDeposit', withdraw: 'casinoTabWithdraw', support: 'casinoSoporteBtn', info: 'casinoTabInfo' };
  Object.keys(map).forEach(function(k) {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle('cwTabOn', k === key);
  });
};

VIP.ui.casinoBotGo = function(state) {
  const area = document.getElementById('casinoBotArea');
  if (!area) return;
  // #300: qué había abierto ANTES (se captura antes de restaurar el chat / pisar
  // _botState) — tocar "Depositar" de nuevo estando en la carga con agente o en
  // la tarjeta del CBU vuelve a la elección de modo.
  const _wasManualChat = !!document.getElementById('casinoManualBar');
  const _prevState = VIP.ui._botState;
  // #299: pestaña activa según el estado.
  VIP.ui._setActiveTab(
    (state === 'deposit' || state === 'deposit-mode' || state === 'receipt' || state === 'receipt-sent') ? 'deposit' :
    (state === 'withdraw' ? 'withdraw' : (state === 'info' ? 'info' : null))
  );
  // Si el chat vivo estaba montado (soporte), volver los nodos a la página.
  if (VIP.ui._casinoChatPh) VIP.ui._casinoChatRestoreNodes();
  area.style.display = 'flex';
  const body = document.getElementById('casinoChatDrawerBody');
  if (body) body.style.display = 'none';
  VIP.ui._botStarted = true;
  if (state !== 'info') VIP.ui._botState = state; // #296

  if (state === 'home') {
    area.innerHTML = '';
    // Las opciones viven FIJAS arriba (fila anclada bajo el header) — acá solo
    // el saludo. Volver de cualquier flujo = las opciones siguen a la vista.
    VIP.ui._botMsg('👋 ¡Hola! Soy el <b>asistente de cargas automáticas</b>.<br>' +
      'Elegí una opción acá arriba: <b>depositar</b>, <b>retirar</b> o hablar con <b>soporte</b>.');
    // "TUS DATOS DE INGRESO" (#255): usuario + clave bien visibles — muchos
    // clientes preguntan cuál es su usuario. La clave solo se muestra si se
    // conoce (la escribió en esta sesión, o sigue siendo la default asd123
    // confirmada por el server contra el hash).
    VIP.ui._renderCredsBox();
    // #295: modo de carga elegido + cambiar (solo si ya eligió; si no, la
    // elección aparece al tocar Depositar).
    if (VIP.ui._depositMode()) VIP.ui._botMsg(VIP.ui._depositModeChip());
    // #308: banner chico de referidos (segundo plano, pero que se vea): abre el
    // hub PREMIOS en la tarjeta "Invitá y ganá".
    const _rb = VIP.ui._botMsg('<div onclick="VIP.ui._rwInviteFriends()" style="display:flex;align-items:center;gap:9px;cursor:pointer;">' +
      '<span style="font-size:22px;flex:none;">🤝</span>' +
      '<div style="flex:1;min-width:0;line-height:1.3;"><b style="color:#ff9800;">Invitá amigos y ganá ' + VIP.ui._rwRefPctTxt() + '</b> de comisión por su actividad en la sala, todos los meses.' +
      '<div style="font-size:11px;opacity:.8;">Tocá: se copia tu link y elegís por dónde mandarlo 👉</div></div></div>');
    if (!VIP.ui._rwRef) { try { VIP.ui._rwLoadReferrals(); } catch (e) {} } // precargar el link
    if (_rb) { _rb.style.border = '1px solid rgba(255,152,0,0.55)'; _rb.style.background = 'linear-gradient(135deg,rgba(255,152,0,0.12),rgba(255,152,0,0.04))'; }
    // (owner 2026-09-02: se SACÓ del asistente el "Estás como X" + botón
    // "Cambiar de cuenta / Salir" de #252 — no quiere que el cliente pueda
    // cerrar sesión desde el widget. VIP.ui.casinoLogout queda definido por si
    // se reactiva; el resto del fix #252 —logout que limpia el casino, SSO
    // fresco, teardown del access-link— sigue vigente.)
    // Las ruletas y el cashback viven en el hub "🎁 PREMIOS" (#254) — ya no se
    // ofrecen en el hilo del chat (pedido owner: recuadro propio, no en el chat).
    return;
  }

  if (state === 'roulette') {
    VIP.ui._renderRoulette();
    return;
  }

  if (state === 'roulette-prize') {
    VIP.ui._renderRoulettePrize();
    return;
  }

  // #290: apartado fijo con usuario + clave (mismo recuadro del inicio).
  if (state === 'creds') {
    area.innerHTML = '';
    VIP.ui._renderCredsBox();
    VIP.ui._botMsg('💡 Con estos datos entrás desde cualquier celular: <b>guardalos</b> o sacá captura. 📸');
    VIP.ui._botRow(VIP.ui._botBtn('🤖 Volver al asistente', 'VIP.ui.casinoBotGo(\'home\')', false));
    area.scrollTop = 0;
    return;
  }

  if (state === 'info') {
    // #296: el botón "¿Cómo funciona?" es un TOGGLE — si ya está abierto,
    // volver a tocarlo lo cierra (vuelve al inicio del asistente).
    if (VIP.ui._botState === 'info') { VIP.ui._botState = null; VIP.ui.casinoBotGo('home'); return; }
    VIP.ui._botState = 'info';
    area.innerHTML = '';
    VIP.ui._botMsg(
      'ℹ️ <b>¿Cómo funciona?</b> Es todo <b>automático</b> 👇' +
      '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">' +
      '<div class="cwBox" style="border-radius:9px;padding:9px 11px;"><b>💳 Depositar</b> — 2 formas, elegís vos:<br>' +
      '<b>⚡ Automática:</b> tocá <b>Quiero Depositar</b>, transferí al CBU/alias que te damos y mandá el comprobante. ' +
      'Se acredita <b>sola en segundos</b> — sin esperar a nadie.<br>' +
      '<b>💬 Con un agente:</b> todo por chat con una persona: te pasa los datos, le mandás la captura y te carga. ' +
      'Cambiás de una a otra cuando quieras (<span class="cwGrn" onclick="VIP.ui.casinoBotGo(\'deposit-mode\')" style="font-weight:800;cursor:pointer;text-decoration:underline;">elegir</span>).</div>' +
      '<div class="cwBox" style="border-radius:9px;padding:9px 11px;"><b>💸 Retirar</b><br>' +
      'Tocá <b>Solicitar Retiro</b>, poné el monto y tu CBU/alias. El pago sale <b>automático</b> ' +
      'a tu cuenta tras la verificación.</div>' +
      '<div class="cwBox" style="border-radius:9px;padding:9px 11px;"><b>🎰 Jugar</b><br>' +
      'Ya estás adentro de 1Girox con tu sesión iniciada. Cargá y jugá al instante.</div>' +
      '<div class="cwBox" style="border-radius:9px;padding:9px 11px;"><b>🎧 Soporte</b><br>' +
      'Si algo no funciona, tocá <b>Soporte</b> y te atiende una persona.</div>' +
      '</div>');
    VIP.ui._botRow(VIP.ui._botBtn('✕ Cerrar', "VIP.ui.casinoBotGo('home')"));
    // Que se vea desde ARRIBA (owner 2026-08-22): _botMsg baja al fondo, y como
    // es un solo bloque largo quedaba mostrando el final. Se sube al inicio.
    area.scrollTop = 0;
    return;
  }

  if (state === 'deposit-mode') {
    area.innerHTML = '';
    const cur = VIP.ui._depositMode();
    const opt = function(mode, icon, titulo, desc, tag) {
      const sel = cur === mode;
      return '<div class="cwBox" onclick="VIP.ui.setDepositMode(\'' + mode + '\', true)" style="border-radius:11px;padding:11px 12px;cursor:pointer;' +
        (sel ? 'outline:2px solid #25d366;' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:22px;">' + icon + '</span>' +
        '<div style="flex:1;"><b style="font-size:13.5px;">' + titulo + '</b>' + (tag ? ' <span style="font-size:10px;font-weight:800;background:#25d366;color:#fff;border-radius:6px;padding:1px 6px;">' + tag + '</span>' : '') +
        '<div class="cwMut" style="font-size:12px;line-height:1.35;margin-top:2px;">' + desc + '</div></div>' +
        (sel ? '<span style="color:#25d366;font-weight:900;">✓</span>' : '') + '</div></div>';
    };
    VIP.ui._botMsg('💳 <b>¿Cómo querés cargar?</b> Elegí la forma que más te convenga — podés cambiarla cuando quieras.' +
      '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">' +
      opt('auto', '⚡', 'Carga automática', 'Te mostramos el CBU/alias, transferís, mandás el comprobante y se acredita <b>sola en segundos</b>. La más rápida y fácil.', 'RECOMENDADA') +
      opt('manual', '💬', 'Carga con un agente', 'Hablás por chat con una persona: te pasa los datos, le mandás la captura y te carga. Ideal si preferís que te acompañen.') +
      '</div>');
    VIP.ui._botRow(VIP.ui._botBtn('↩ Volver', "VIP.ui.casinoBotGo('home')"));
    return;
  }

  if (state === 'deposit') {
    // #295: según el modo elegido. Sin elegir → pantalla de elección.
    const mode = VIP.ui._depositMode();
    if (!mode) { VIP.ui.casinoBotGo('deposit-mode'); return; }
    // #300: segundo toque en "Depositar" = volver a elegir entre las 2 formas.
    if ((mode === 'manual' && _wasManualChat) || (mode === 'auto' && _prevState === 'deposit' && document.getElementById('botDepositCard'))) {
      VIP.ui.casinoBotGo('deposit-mode');
      return;
    }
    if (mode === 'manual') { VIP.ui.casinoBotManualDeposit(); return; }
    // #299: pestaña propia — solo lo de depositar (antes se apilaba debajo del
    // saludo + "Mis datos" y al scrollear aparecía el usuario arriba del CBU).
    area.innerHTML = '';
    let card = document.getElementById('botDepositCard');
    // THROTTLE anti-spam: doble-tap en <2s no hace nada (evita apilar).
    if (card && (Date.now() - (VIP.ui._botDepositAt || 0) < 2000)) {
      area.scrollTop = area.scrollHeight;
      return;
    }
    const doRefresh = function(c, node) {
      const n = node.querySelector('#botCbuNumber'); if (n) n.textContent = c.number || '—';
      const a = node.querySelector('#botCbuAlias'); if (a) a.textContent = c.alias || '—';
      const t = node.querySelector('#botCbuTitular'); if (t) t.textContent = c.titular || c.bank || '—';
    };
    // Si la tarjeta ya existe Y sigue siendo lo ÚLTIMO del chat → solo refrescar.
    // Si hubo mensajes después (ej. "carga acreditada"), la tarjeta vieja quedó
    // arriba → se BORRA y se crea una NUEVA abajo (owner 2026-08-21: que el CBU
    // vuelva a aparecer abajo tras una carga).
    if (card) {
      const isLast = area.lastElementChild === card ||
        (area.lastElementChild && area.lastElementChild.previousElementSibling === card);
      if (isLast) {
        VIP.ui._botDepositAt = Date.now();
        area.scrollTop = area.scrollHeight;
        if (VIP.ui._botCbu && VIP.ui._botCbu.number) doRefresh(VIP.ui._botCbu, card);
        fetch(`${VIP.config.API_URL}/api/cbu/request`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
          if (d && d.cbu) { VIP.ui._botCbu = d.cbu; doRefresh(d.cbu, card); }
        }).catch(function() {});
        return;
      }
      // Quedó arriba → sacarle el id a la vieja para no chocar y crear una nueva.
      card.id = '';
    }
    VIP.ui._botDepositAt = Date.now();
    card = VIP.ui._botMsg('Para depositar, transferí a los siguientes datos:<br>' +
      '<span style="color:#8a8fa3;">⏳ Cargando datos…</span>');
    if (card) card.id = 'botDepositCard';
    const renderCard = function() {
        if (!card) return;
        // Valores por textContent (config del panel → nunca se inyecta HTML).
        card.innerHTML =
          'Para depositar, realizá una transferencia a los siguientes datos:' +
          '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">' +
            '<div class="cwBox" style="border-radius:9px;padding:8px 10px;">' +
              '<div class="cwLbl" style="font-size:10.5px;font-weight:700;letter-spacing:0.4px;">CBU</div>' +
              '<div style="display:flex;gap:6px;align-items:center;">' +
              '<b id="botCbuNumber" class="cwVal" style="flex:1;word-break:break-all;font-size:13px;"></b>' +
              '<button type="button" onclick="VIP.ui.casinoBotCopy(\'number\')" style="background:#128c4a;color:#fff;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:800;cursor:pointer;flex:0 0 auto;">Copiar CBU</button></div></div>' +
            '<div class="cwBox" style="border-radius:9px;padding:8px 10px;">' +
              '<div class="cwLbl" style="font-size:10.5px;font-weight:700;letter-spacing:0.4px;">ALIAS</div>' +
              '<div style="display:flex;gap:6px;align-items:center;">' +
              '<b id="botCbuAlias" class="cwVal" style="flex:1;word-break:break-all;font-size:13px;"></b>' +
              '<button type="button" onclick="VIP.ui.casinoBotCopy(\'alias\')" style="background:#128c4a;color:#fff;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:800;cursor:pointer;flex:0 0 auto;">Copiar Alias</button></div></div>' +
            '<div class="cwBox" style="border-radius:9px;padding:8px 10px;">' +
              '<div class="cwLbl" style="font-size:10.5px;font-weight:700;letter-spacing:0.4px;">TITULAR</div>' +
              '<b id="botCbuTitular" class="cwVal" style="font-size:13px;"></b></div>' +
            '<div class="cwWarn" style="border-radius:8px;padding:7px 9px;font-size:12px;font-weight:700;text-align:center;">Depósito mínimo: $2.000</div>' +
          '</div>';
        const c = VIP.ui._botCbu;
        card.querySelector('#botCbuNumber').textContent = c.number || '—';
        card.querySelector('#botCbuAlias').textContent = c.alias || '—';
        card.querySelector('#botCbuTitular').textContent = c.titular || c.bank || '—';
        VIP.ui._botRow(
          VIP.ui._botBtn('✅ Ya hice la transferencia', "VIP.ui.casinoBotGo('receipt')", true) +
          VIP.ui._botBtn('↩ Volver', "VIP.ui.casinoBotGo('home')")
        );
        // #295: pasar a carga con un agente en 1 toque.
        const sw = VIP.ui._botMsg('<span class="cwGrn" onclick="VIP.ui.setDepositMode(\'manual\', true)" style="font-weight:800;cursor:pointer;">💬 Prefiero cargar hablando con un agente →</span>');
        if (sw) { sw.className = ''; sw.style.background = 'transparent'; sw.style.boxShadow = 'none'; sw.style.padding = '2px 4px'; sw.style.textAlign = 'center'; }
    };
    // Cache client-side: el endpoint tiene rate limit de 10s por usuario — un
    // ida-y-vuelta rápido por el bot no debe rebotar en 429.
    if (VIP.ui._botCbu && VIP.ui._botCbu.number) { renderCard(); return; }
    fetch(`${VIP.config.API_URL}/api/cbu/request`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function(data) {
        VIP.ui._botCbu = (data && data.cbu) || {};
        renderCard();
      })
      .catch(function() {
        // La automatización falló → fallback al chat humano (regla del owner).
        if (card) card.innerHTML = '⚠️ No pudimos traer los datos en este momento. Escribile a soporte y te los pasa al toque.';
        VIP.ui._botRow(VIP.ui._botBtn('🎧 Hablar con soporte', 'VIP.ui.casinoBotSupport()', true));
      });
    return;
  }

  if (state === 'receipt') {
    // Guard anti-duplicado (owner 2026-08-21: salía 2 veces al tocar "Ya hice
    // la transferencia" más de una vez). Si el bloque ya está, no se repite.
    const existing = document.getElementById('botReceiptBlock');
    if (existing) { area.scrollTop = area.scrollHeight; return; }
    VIP.ui._botMsg('📸 Envianos una <b>foto o captura de pantalla</b> del comprobante de la transferencia.');
    const box = VIP.ui._botMsg('');
    if (box) {
      box.id = 'botReceiptBlock';
      box.className = 'cwB cwUp';
      box.style.cssText += 'text-align:center;cursor:pointer;';
      box.innerHTML = '📎 <b>Tocá acá para seleccionar el comprobante</b><br><span style="font-size:11px;opacity:0.75;">Imagen o captura</span>';
      box.onclick = function() { VIP.ui.casinoBotPickReceipt(); };
    }
    VIP.ui._botRow(VIP.ui._botBtn('↩ Volver', "VIP.ui.casinoBotGo('deposit')"));
    return;
  }

  if (state === 'withdraw') {
    // RETIRO adentro del panel (owner 2026-08-21, calco de Bet33): disponible
    // para retirar + monto + CBU/CVU o alias + titular + Confirmar. El pedido
    // real va por /api/withdrawal/request (mismos guards de siempre: mínimo
    // $4.999, wagering.available, SMS obligatorio si el teléfono no está
    // verificado — en ese caso se deriva al formulario completo con OTP).
    area.innerHTML = '';
    const back = VIP.ui._botMsg('<span class="cwGrn" onclick="VIP.ui.casinoBotGo(\'home\')" style="font-weight:800;cursor:pointer;">← Volver al chat</span>');
    if (back) { back.className = ''; back.style.background = 'transparent'; back.style.boxShadow = 'none'; }
    const form = VIP.ui._botMsg('');
    if (!form) return;
    form.innerHTML =
      '<div class="cwVal" style="font-size:17px;font-weight:800;margin-bottom:8px;">Solicitar Retiro</div>' +
      '<div class="cwBox" style="border-radius:9px;padding:10px;text-align:center;margin-bottom:10px;">' +
        '<div class="cwLbl" style="font-size:11.5px;">Disponible para retirar</div>' +
        '<div id="botWdAvail" class="cwVal" style="font-size:22px;font-weight:900;">⏳</div></div>' +
      '<div class="cwLbl" style="font-size:12px;font-weight:700;margin-bottom:3px;">Monto a retirar</div>' +
      '<input id="botWdAmount" class="cwIn" type="number" inputmode="numeric" min="4999" placeholder="$0" ' +
        'style="width:100%;box-sizing:border-box;border-radius:9px;padding:10px;font-size:14px;margin-bottom:8px;">' +
      '<div class="cwLbl" style="font-size:12px;font-weight:700;margin-bottom:3px;">CBU o CVU (o alias)</div>' +
      '<input id="botWdCbu" class="cwIn" type="text" placeholder="Ingresá tu CBU/CVU de 22 dígitos o tu alias" ' +
        'style="width:100%;box-sizing:border-box;border-radius:9px;padding:10px;font-size:13.5px;margin-bottom:8px;">' +
      '<div class="cwLbl" style="font-size:12px;font-weight:700;margin-bottom:3px;">Titular de la cuenta</div>' +
      '<input id="botWdTitular" class="cwIn" type="text" placeholder="Nombre completo" ' +
        'style="width:100%;box-sizing:border-box;border-radius:9px;padding:10px;font-size:13.5px;margin-bottom:6px;">' +
      '<div id="botWdError" style="display:none;color:#e05a5a;font-size:12px;font-weight:700;margin-bottom:6px;"></div>' +
      '<button type="button" id="botWdSubmit" onclick="VIP.ui.casinoBotWithdrawSubmit()" ' +
        'style="width:100%;background:#128c4a;color:#fff;border:none;border-radius:10px;padding:13px;' +
        'font-size:14.5px;font-weight:800;cursor:pointer;">Confirmar Retiro</button>' +
      '<div class="cwMut" style="font-size:11px;text-align:center;margin-top:5px;">Retiro mínimo: $4.999</div>';
    // Disponible real (descuenta el rollover): /api/balance/live → available.
    fetch(`${VIP.config.API_URL}/api/balance/live`, {
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
    }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      const el = document.getElementById('botWdAvail');
      if (!el) return;
      const avail = d && (d.available !== undefined && d.available !== null ? d.available : d.balance);
      el.textContent = (avail !== undefined && avail !== null)
        ? '$' + Number(avail).toLocaleString('es-AR') : '—';
    }).catch(function() {
      const el = document.getElementById('botWdAvail');
      if (el) el.textContent = '—';
    });
    // "Tus últimos retiros" (owner 2026-08-22): estado de los últimos retiros;
    // si uno salió RECHAZADO, muestra el motivo acá mismo + "Hablar con soporte".
    VIP.ui._renderMyWithdrawals();
    return;
  }

  if (state === 'receipt-sent') {
    VIP.ui._botMsg('✅ <b>¡Comprobante recibido!</b> Lo estamos verificando para acreditarte las fichas.');
    // CUENTA REGRESIVA de 15s (owner 2026-08-21): si la carga automática no
    // acreditó en ese tiempo, cartel pidiendo el comprobante legible. La
    // confirmación real (balance_updated → casinoBotDepositConfirmed) CORTA
    // el reloj y muestra el "¡Carga acreditada!".
    clearInterval(VIP.ui._botCdTimer);
    const cd = VIP.ui._botMsg('⏳ Acreditación automática en curso… <b id="botCdNum" style="color:#25d366;">15</b>s');
    VIP.ui._botCdNode = cd;
    let left = 15;
    VIP.ui._botCdTimer = setInterval(function() {
      left--;
      const n = document.getElementById('botCdNum');
      if (n) n.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(VIP.ui._botCdTimer);
        VIP.ui._botCdTimer = null;
        if (cd) cd.style.display = 'none';
        VIP.ui._botMsg('⚠️ <b>Todavía no pudimos acreditar tu carga automáticamente.</b><br>' +
          'Verificá que el comprobante esté COMPLETO y legible (monto, fecha, N° de operación y cuenta destino) ' +
          'y reenvialo. 📸<br><span style="color:#8a8fa3;font-size:12px;">Si ya se ve bien, quedate tranquilo: ' +
          'un agente lo está revisando y te acreditamos enseguida.</span>');
        VIP.ui._botRow(
          VIP.ui._botBtn('📸 Reenviar comprobante', "VIP.ui.casinoBotGo('receipt')", true) +
          VIP.ui._botBtn('🎧 Hablar con soporte', 'VIP.ui.casinoBotSupport()')
        );
      }
    }, 1000);
    VIP.ui._botRow(VIP.ui._botBtn('🎰 Volver al juego', 'VIP.ui.closeCasinoChat()'));
    return;
  }
};

/** Copiar CBU/alias al portapapeles (con fallback para navegadores viejos). */
VIP.ui.casinoBotCopy = function(kind) {
  const c = VIP.ui._botCbu || {};
  const val = kind === 'alias' ? c.alias : c.number;
  if (!val) return;
  const ok = function() { VIP.ui.showToast('✅ Copiado: ' + val, 'success'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(val)).then(ok, function() { window.prompt('Copialo manualmente:', val); });
      return;
    }
  } catch (e) {}
  window.prompt('Copialo manualmente:', val);
};

/** Abre el selector de archivo del chat (el envío usa el flujo REAL: la imagen
 *  entra al chat, la IA la verifica y la auto-carga acredita — todo existente). */
VIP.ui.casinoBotPickReceipt = function() {
  const fi = document.getElementById('fileInput');
  if (!fi) { VIP.ui.casinoBotSupport(); return; }
  VIP.ui._botAwaitingReceipt = true;
  if (!VIP.ui._botFileHook) {
    VIP.ui._botFileHook = true;
    fi.addEventListener('change', function() {
      if (!VIP.ui._botAwaitingReceipt) return;
      if (!fi.files || !fi.files.length) return;
      VIP.ui._botAwaitingReceipt = false;
      // El envío real lo maneja chat.js con este mismo change; acá solo se
      // avanza la conversación del bot (pequeño delay para el procesamiento).
      setTimeout(function() { VIP.ui.casinoBotGo('receipt-sent'); }, 600);
    });
  }
  fi.click();
};

// (owner 2026-08-25) Removido VIP.ui.casinoBotWithdraw: wrapper sin callers
// (el flujo usa casinoBotGo('withdraw') directo). Ver WORKLOG #234.

/** "Tus últimos retiros" dentro de la sección de Retiro: estado de cada uno y,
 *  si salió RECHAZADO, el motivo + botón "Hablar con soporte" (owner
 *  2026-08-22). Reemplaza al mensaje de rechazo en el chat (que quedaba tapado
 *  por la bienvenida de soporte). */
VIP.ui._renderMyWithdrawals = function() {
  const area = document.getElementById('casinoBotArea');
  if (!area) return;
  fetch(`${VIP.config.API_URL}/api/withdrawal/mine`, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    const list = (d && d.payouts) || [];
    if (!list.length) return;
    // Si el estado 'withdraw' ya cambió (el usuario navegó), no pintar.
    if (!document.getElementById('botWdSubmit')) return;
    const STATUS = {
      pending_review: { t: '⏳ Pendiente', c: '#e3bd48' },
      paying:         { t: '⏳ Procesando', c: '#e3bd48' },
      paid:           { t: '✅ Pagado', c: '#25d366' },
      failed:         { t: '⚠️ Con problema', c: '#e0a05a' },
      cancelled:      { t: '❌ Rechazado', c: '#e05a5a' }
    };
    let html = '<div class="cwVal" style="font-size:14px;font-weight:800;margin-bottom:8px;">📋 Tus últimos retiros</div>';
    list.forEach(function(p) {
      const st = STATUS[p.status] || { t: p.status, c: '#8a939b' };
      const monto = '$' + (Number(p.amount) || 0).toLocaleString('es-AR');
      let fecha = '';
      try { fecha = new Date(p.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }); } catch (e) {}
      html += '<div class="cwBox" style="border-radius:9px;padding:9px 11px;margin-bottom:6px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
          '<b class="cwVal" style="font-size:14px;">' + monto + '</b>' +
          '<span style="color:' + st.c + ';font-size:12px;font-weight:800;">' + st.t + '</span></div>' +
        (fecha ? '<div class="cwMut" style="font-size:10.5px;">' + fecha + '</div>' : '');
      if (p.status === 'cancelled') {
        html += '<div style="margin-top:6px;background:rgba(224,90,90,0.12);border-radius:8px;padding:7px 9px;">' +
          '<div style="color:#e05a5a;font-size:11.5px;font-weight:700;">Motivo del rechazo:</div>' +
          '<div class="cwVal" style="font-size:12.5px;">' + _wrEsc(p.rejectReason || 'No especificado. Consultá con soporte.') + '</div>' +
          '<button type="button" onclick="VIP.ui.casinoBotSupport()" style="margin-top:7px;width:100%;' +
          'background:#128c4a;color:#fff;border:none;border-radius:9px;padding:9px;font-size:12.5px;font-weight:800;cursor:pointer;">' +
          '¿Creés que es un error? Hablá con soporte 🎧</button></div>';
      }
      // Comprobante del pago confirmado por hgcash (owner 2026-08-22).
      if (p.status === 'paid' && p.receiptUrl) {
        html += '<a href="' + _wrEsc(p.receiptUrl) + '" target="_blank" rel="noopener" ' +
          'style="display:block;margin-top:6px;text-align:center;background:rgba(37,211,102,0.14);' +
          'color:#25d366;border-radius:8px;padding:8px;font-size:12.5px;font-weight:800;text-decoration:none;">' +
          '📄 Ver comprobante del pago</a>';
      }
      html += '</div>';
    });
    const box = VIP.ui._botMsg(html);
    if (box) area.scrollTop = area.scrollHeight;
  }).catch(function() {});
};

/** Envía la solicitud de retiro del form del panel. */
VIP.ui.casinoBotWithdrawSubmit = async function() {
  const err = document.getElementById('botWdError');
  const showErr = function(msg) { if (err) { err.textContent = msg; err.style.display = 'block'; } };
  if (err) err.style.display = 'none';

  const amount = parseFloat((document.getElementById('botWdAmount') || {}).value || '');
  const dest = String((document.getElementById('botWdCbu') || {}).value || '').trim();
  const titular = String((document.getElementById('botWdTitular') || {}).value || '').trim();
  if (!Number.isFinite(amount) || amount < 4999) return showErr('El retiro mínimo es de $4.999.');
  if (!dest) return showErr('Ingresá tu CBU/CVU de 22 dígitos o tu alias.');
  const destDigits = dest.replace(/\D/g, '');
  const isCbu = destDigits.length === 22 && /^\d+$/.test(dest.replace(/[\s-]/g, ''));
  if (!isCbu && dest.length < 6) return showErr('El alias es muy corto (o el CBU no tiene 22 dígitos).');
  if (!titular || titular.length < 5) return showErr('Ingresá el nombre completo del titular.');

  const btn = document.getElementById('botWdSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const metaEventId = (VIP.pixel && VIP.pixel.enabled) ? VIP.pixel.newEventId() : null;
    const res = await fetch(`${VIP.config.API_URL}/api/withdrawal/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VIP.state.currentToken}` },
      body: JSON.stringify({
        titular,
        cbu: isCbu ? destDigits : null,
        alias: isCbu ? null : dest,
        amount,
        metaEventId
      })
    });
    const data = await res.json().catch(function() { return {}; });
    if (res.ok && data.success) {
      if (VIP.pixel && metaEventId) {
        VIP.pixel.trackWithId(metaEventId, 'WithdrawRequest', { value: amount, currency: 'ARS' });
      }
      const area = document.getElementById('casinoBotArea');
      if (area) area.innerHTML = '';
      VIP.ui._botMsg('✅ <b>¡Retiro solicitado por $' + amount.toLocaleString('es-AR') + '!</b><br>' +
        'Lo estamos verificando y el pago sale automático a tu cuenta. Te avisamos acá cuando esté transferido 🔔');
      VIP.ui._botRow(VIP.ui._botBtn('🎰 Volver al juego', 'VIP.ui.closeCasinoChat()', true));
      try { if (VIP.ui.syncBalance) setTimeout(VIP.ui.syncBalance, 1500); } catch (e) {}
      return;
    }
    if (data.code === 'PHONE_VERIFICATION_REQUIRED') {
      // Seguridad: primera vez necesita verificar el teléfono por SMS → se
      // deriva al formulario completo (tiene el paso de OTP integrado).
      VIP.ui._botMsg('🔐 Por tu seguridad, para el <b>primer retiro</b> tenés que verificar tu teléfono por SMS. ' +
        'Te abrimos el formulario completo para hacerlo en un paso.');
      const modal = document.getElementById('withdrawModal');
      if (modal) modal.style.zIndex = '100001'; // sobre el overlay del casino
      if (VIP.withdraw && VIP.withdraw.openWithdrawModal) VIP.withdraw.openWithdrawModal();
      else VIP.ui.casinoBotSupport();
    } else {
      showErr(data.error || 'No se pudo procesar el retiro. Probá de nuevo.');
    }
  } catch (e) {
    showErr('Error de conexión. Probá de nuevo.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Retiro'; }
  }
};

/** Aviso claro de que respondió SOPORTE (owner 2026-08-22): badge rojo en el
 *  botón "🎧 Soporte" + toast, para que el usuario sepa que el sonido vino de
 *  soporte y dónde tocar. Solo cuando NO está viendo el chat de soporte. */
VIP.ui._supportUnread = 0;
VIP.ui._notifySupportReply = function(n) {
  VIP.ui._supportUnread = (VIP.ui._supportUnread || 0) + (n || 1);
  const badge = document.getElementById('casinoSoporteBadge');
  if (badge) {
    badge.textContent = VIP.ui._supportUnread > 9 ? '9+' : String(VIP.ui._supportUnread);
    badge.style.display = 'inline-block';
  }
  // Toast (throttle 4s para no repetir con cada mensaje de una ráfaga).
  const now = Date.now();
  if (now - (VIP.ui._supportToastAt || 0) > 4000) {
    VIP.ui._supportToastAt = now;
    if (VIP.ui.showToast) VIP.ui.showToast('💬 Soporte te respondió — tocá 🎧 Soporte', 'info');
  }
};

VIP.ui._clearSupportUnread = function() {
  VIP.ui._supportUnread = 0;
  const badge = document.getElementById('casinoSoporteBadge');
  if (badge) badge.style.display = 'none';
};

/** FALLBACK humano: muda el chat real adentro del panel (modo soporte). */
VIP.ui.casinoBotSupport = function() {
  VIP.ui._clearSupportUnread(); // el usuario entra a ver soporte → sin pendientes
  VIP.ui._casinoChatMount();
  VIP.ui._setActiveTab('support'); // #299
  // Bienvenida automática del soporte (server-side, editable en COMANDOS como
  // /sys_soporte_bienvenida, con throttle para no spamear al agente). El
  // mensaje llega por socket y aparece en el chat recién montado.
  try {
    fetch(`${VIP.config.API_URL}/api/support/hello`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).catch(function() {});
  } catch (e) {}
  // Que SIEMPRE se vea el último mensaje: además del scroll del mount (rAF),
  // un segundo scroll cuando el historial ya terminó de renderizar.
  setTimeout(function() {
    try {
      const msgs = document.getElementById('chatMessages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    } catch (e) {}
  }, 600);
};

// ============================================================
// RULETA DE BIENVENIDA (2026-08-21) — se gira una vez; el premio lo decide el
// SERVER (spin), el cliente solo ve la animación caer en el segmento premiado.
// ============================================================
VIP.ui._maybeOfferWelcomeRoulette = function() {
  // El status se pide UNA vez por sesión de widget y se cachea; cada vez que se
  // vuelve al inicio se re-muestra lo que corresponda: la oferta de girar, o
  // el acceso a "Mi premio" si ya giró (owner 2026-08-28: poder volver a verlo).
  const show = function(d) {
    if (!d) return;
    if (d.canSpin) {
      VIP.ui._botMsg('🎁 <b>¡Tenés una RULETA DE BIENVENIDA!</b><br>Girá y ganá tu premio 🎡');
      VIP.ui._botRow(VIP.ui._botBtn('🎡 ¡GIRAR LA RULETA!', 'VIP.ui.casinoBotGo(\'roulette\')', true));
    } else if (d.alreadySpun && d.prize) {
      VIP.ui._botRow(VIP.ui._botBtn('🎡 Mi premio de la ruleta', 'VIP.ui.casinoBotGo(\'roulette-prize\')', false));
    }
  };
  if (VIP.ui._wrOffered) { show(VIP.ui._wrStatus); return; }
  fetch(`${VIP.config.API_URL}/api/welcome-roulette/status`, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    if (!d) return;
    VIP.ui._wrOffered = true;
    VIP.ui._wrStatus = d;
    VIP.ui._wrSegments = (d.segments || []).map(function(s) { return s.label; });
    show(d);
  }).catch(function() {});
};

/** Pantalla "Mi premio": qué le salió, en qué estado está, y desde cuándo.
 *  Queda accesible siempre (para verlo de nuevo o sacar captura). */
VIP.ui._renderRoulettePrize = function() {
  const area = document.getElementById('casinoBotArea');
  if (!area) return;
  area.innerHTML = '';
  VIP.ui._botMsg('⏳ Buscando tu premio…');
  fetch(`${VIP.config.API_URL}/api/welcome-roulette/status`, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    area.innerHTML = '';
    const p = d && d.prize;
    if (!p) {
      VIP.ui._botMsg('🎡 Todavía no giraste la ruleta.');
      if (d && d.canSpin) VIP.ui._botRow(VIP.ui._botBtn('🎡 ¡GIRAR LA RULETA!', 'VIP.ui.casinoBotGo(\'roulette\')', true));
      return;
    }
    VIP.ui._wrStatus = d;
    const fmt = function(x) { try { return new Date(x).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    let estado = '';
    if (p.type === 'cash') {
      estado = '💰 <b>Acreditado en tu saldo</b>' + (p.rolloverX > 0 ? ' — para retirarlo tenés que apostar ' + p.rolloverX + ' veces el premio.' : '.');
    } else if (p.status === 'pending') {
      estado = '⏳ <b>Pendiente</b> — se te suma automáticamente en tu <b>próxima carga</b> (' + _wrEsc(String(p.value)) + '% extra).' + _wrBonusRuleTxt(p.value);
    } else {
      estado = '✅ <b>Ya aplicado</b>' + (p.usedAt ? ' el ' + fmt(p.usedAt) : '') + ' en una carga.';
    }
    VIP.ui._botMsg(
      '<div style="text-align:center;padding:6px 0;">' +
        '<div style="font-size:13px;opacity:.85;">🎡 Tu premio de la ruleta</div>' +
        '<div style="font-size:26px;font-weight:900;color:#ffd700;margin:6px 0;text-shadow:0 1px 3px rgba(0,0,0,.6);">' + _wrEsc(p.label || '') + '</div>' +
        '<div style="font-size:13px;line-height:1.35;">' + estado + '</div>' +
        (p.spunAt ? '<div style="font-size:11px;opacity:.7;margin-top:8px;">Giraste el ' + fmt(p.spunAt) + '</div>' : '') +
        '<div style="font-size:11px;opacity:.7;margin-top:4px;">📸 Podés sacar captura de esta pantalla cuando quieras.</div>' +
      '</div>');
    if (p.type === 'percent' && p.status === 'pending') {
      VIP.ui._botRow(VIP.ui._botBtn('💳 Cargar ahora y usarlo', "VIP.ui.casinoBotGo('deposit')", true));
    }
    VIP.ui._botRow(VIP.ui._botBtn('↩️ Volver', "VIP.ui.casinoBotGo('home')", false));
  }).catch(function() {
    area.innerHTML = '';
    VIP.ui._botMsg('No pude cargar tu premio. Probá de nuevo.');
    VIP.ui._botRow(VIP.ui._botBtn('↩️ Volver', "VIP.ui.casinoBotGo('home')", false));
  });
};

/** Dibuja la ruleta en un OVERLAY a pantalla completa (owner 2026-08-28: que
 *  tape toda la pantalla, no solo el chat). Por encima del casino y del widget.
 *  El resultado se muestra en el mismo overlay; al cerrar vuelve al inicio del
 *  asistente (donde queda "🎡 Mi premio de la ruleta"). */
VIP.ui._renderRoulette = function() {
  VIP.ui.casinoRouletteClose(true);
  const segs = VIP.ui._wrSegments || [];
  const n = Math.max(1, segs.length);
  const S = VIP.ui._wheelSize();
  const fs = S >= 320 ? 16 : (S >= 280 ? 14 : 12);
  const ov = document.createElement('div');
  ov.id = 'wrOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.9);display:flex;flex-direction:column;' +
    // justify-content:center RECORTABA la parte de arriba en pantallas cortas
    // (bug de flex+overflow) → top-aligned con padding; scroll táctil iOS (#261).
    'align-items:center;padding:calc(26px + env(safe-area-inset-top,0px)) 16px calc(26px + env(safe-area-inset-bottom,0px));' +
    'box-sizing:border-box;font-family:inherit;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;';
  ov.innerHTML =
    '<button type="button" onclick="VIP.ui.casinoRouletteClose()" aria-label="Cerrar" ' +
      'style="position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:50%;border:none;background:rgba(255,255,255,.14);' +
      'color:#fff;font-size:20px;font-weight:900;cursor:pointer;">✕</button>' +
    '<div style="color:#ffd700;font-size:22px;font-weight:900;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.6);">🎡 RULETA DE BIENVENIDA</div>' +
    '<div style="color:#fff;opacity:.85;font-size:14px;margin:4px 0 16px;text-align:center;">Girás una sola vez. ¡Suerte!</div>' +
    VIP.ui._wheelMarkup({ S: S, segs: segs, fs: fs, accent: '#ffd700', accent2: '#b8860b',
      palette: ['#7a0b1f', '#0f3d2a', '#1a1a4a', '#5a3a00', '#2b0a3d', '#0b3d5a'] }) +
    '<div id="wrResult" style="color:#fff;text-align:center;font-size:15px;line-height:1.35;max-width:360px;"></div>' +
    '<div id="wrActions" style="width:100%;max-width:360px;display:flex;flex-direction:column;gap:10px;margin-top:6px;">' +
      '<button type="button" id="wrSpinBtn" onclick="VIP.ui.casinoRouletteSpin()" ' +
        'style="width:100%;background:#ffd700;color:#3a2c00;border:none;border-radius:16px;padding:16px;' +
        'font-size:19px;font-weight:900;cursor:pointer;box-shadow:0 6px 18px rgba(255,215,0,.35);">🎡 GIRAR</button>' +
    '</div>';
  document.body.appendChild(ov);
  VIP.ui._wrOverlayOpen = true;
};

// ============================================================
// RUEDA PREMIUM (#291, owner: "parece una ruleta hecha en Paint"). Compartida
// por las dos ruletas. Capas: aro dorado con "luces" (repeating-conic), gajos
// con paleta rica + separadores finos + profundidad radial, brillo superior
// fijo (no gira), cubo central con el logo (no gira) y puntero con pin. El
// elemento que GIRA sigue siendo #wrWheel (el spin no cambió). Las etiquetas
// .wrLbl son radiales y giran con la rueda (#294; antes contra-rotaban).
// ============================================================
// #294: tamaño de la rueda. Antes S = 86% del ancho, pero el aro suma 11% y el
// overlay tiene 16px de padding por lado → en celular sobraban ~15px y aparecía
// un scroll HORIZONTAL. Ahora S se calcula para que rueda + aro entren.
VIP.ui._wheelSize = function() {
  const w = Math.floor((window.innerWidth - 40) / 1.11);
  return Math.max(220, Math.min(w, Math.floor(window.innerHeight * 0.46), 360));
};
VIP.ui._wheelMarkup = function(o) {
  const S = o.S, n = Math.max(1, o.segs.length), R = S / 2;
  const fs = o.fs, pal = o.palette, acc = o.accent, acc2 = o.accent2;
  let stops = '';
  for (let i = 0; i < n; i++) {
    const a0 = (360 / n) * i, a1 = (360 / n) * (i + 1);
    stops += pal[i % pal.length] + ' ' + a0 + 'deg ' + a1 + 'deg' + (i < n - 1 ? ',' : '');
  }
  let labels = '';
  // #294: etiquetas RADIALES centradas en cada gajo (owner: "que estén centrados
  // los nombres"). Antes iban horizontales a radio escalonado y se salían del
  // gajo. Ahora cada una es una barra que va del cubo al aro sobre el eje del
  // gajo (transform-origin en el centro de la rueda) y GIRA con la rueda (ya no
  // contra-rotan). En la mitad izquierda se dan vuelta para que no queden
  // cabeza abajo (se leen del aro hacia el centro).
  const rIn = Math.round(S * 0.135), rOut = Math.round(S * 0.455);
  for (let i = 0; i < n; i++) {
    const ang = (360 / n) * i + (360 / n) / 2;
    const flip = ang > 180 && ang < 360;
    const gold = /\$/.test(o.segs[i] || '');
    const tf = flip
      ? 'rotate(' + (ang + 90) + 'deg) translate(-' + rOut + 'px,-50%)'
      : 'rotate(' + (ang - 90) + 'deg) translateY(-50%)';
    labels += '<div class="wrLbl" style="position:absolute;left:' + R + 'px;top:' + R + 'px;width:' + rOut + 'px;' +
      'box-sizing:border-box;' + (flip ? 'padding-right:' : 'padding-left:') + rIn + 'px;transform-origin:0 0;transform:' + tf + ';' +
      'text-align:center;font-size:' + fs + 'px;line-height:1.1;font-weight:900;letter-spacing:.3px;text-transform:uppercase;' +
      'color:' + (gold ? '#ffe98a' : '#fff') + ';text-shadow:0 1px 2px rgba(0,0,0,.9),0 0 10px rgba(0,0,0,.6);pointer-events:none;">' +
      _wrEsc(o.segs[i] || '') + '</div>';
  }
  const sepDeg = (360 / n).toFixed(4);
  const rim = Math.round(S * 0.055), hub = Math.round(S * 0.19);
  if (!document.getElementById('wrPremiumCss')) {
    const st = document.createElement('style'); st.id = 'wrPremiumCss';
    st.textContent = '@keyframes wrGlow{0%,100%{filter:drop-shadow(0 0 8px rgba(255,215,0,.35))}50%{filter:drop-shadow(0 0 18px rgba(255,215,0,.75))}}' +
      '@keyframes wrLights{to{transform:rotate(30deg)}}';
    document.head.appendChild(st);
  }
  return '<div style="position:relative;width:' + (S + rim * 2) + 'px;height:' + (S + rim * 2) + 'px;margin:6px auto 18px;flex:none;">' +
    // Aro con luces (gira lento en sentido contrario, decorativo)
    '<div style="position:absolute;inset:0;border-radius:50%;' +
      'background:repeating-conic-gradient(from 0deg,' + acc + ' 0deg 4deg,#3a2c00 4deg 12deg);' +
      'box-shadow:0 14px 40px rgba(0,0,0,.75),0 0 0 3px #2a1f00,0 0 0 5px ' + acc2 + ',inset 0 0 0 ' + Math.round(rim * 0.45) + 'px #1a1200;' +
      'animation:wrLights 6s linear infinite alternate;"></div>' +
    // Puntero (fijo) con pin
    '<div style="position:absolute;top:' + (rim - 14) + 'px;left:50%;transform:translateX(-50%);z-index:6;width:0;height:0;' +
      'border-left:15px solid transparent;border-right:15px solid transparent;border-top:30px solid ' + acc + ';' +
      'filter:drop-shadow(0 3px 4px rgba(0,0,0,.7));animation:wrGlow 1.6s ease-in-out infinite;"></div>' +
    '<div style="position:absolute;top:' + (rim - 22) + 'px;left:50%;transform:translateX(-50%);z-index:7;width:16px;height:16px;border-radius:50%;' +
      'background:radial-gradient(circle at 35% 35%,#fff,' + acc + ' 55%,#5a4300);box-shadow:0 2px 6px rgba(0,0,0,.7);"></div>' +
    // Rueda (GIRA)
    '<div id="wrWheel" style="position:absolute;left:' + rim + 'px;top:' + rim + 'px;width:' + S + 'px;height:' + S + 'px;border-radius:50%;' +
      'background:' +
        'repeating-conic-gradient(from 0deg,rgba(255,255,255,.55) 0deg 0.5deg,transparent 0.5deg ' + sepDeg + 'deg),' +
        'radial-gradient(circle at 50% 50%,rgba(255,255,255,.14) 0%,rgba(255,255,255,0) 45%,rgba(0,0,0,.45) 100%),' +
        'conic-gradient(' + stops + ');' +
      'box-shadow:inset 0 0 0 2px rgba(0,0,0,.5),inset 0 0 40px rgba(0,0,0,.55);' +
      'transition:transform 4.2s cubic-bezier(.17,.67,.2,1);">' + labels + '</div>' +
    // Brillo superior (fijo, no gira)
    '<div style="position:absolute;left:' + rim + 'px;top:' + rim + 'px;width:' + S + 'px;height:' + S + 'px;border-radius:50%;pointer-events:none;z-index:4;' +
      'background:radial-gradient(ellipse at 50% 18%,rgba(255,255,255,.22) 0%,rgba(255,255,255,.05) 35%,rgba(255,255,255,0) 60%);"></div>' +
    // Cubo central con logo (fijo)
    '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;width:' + hub + 'px;height:' + hub + 'px;border-radius:50%;' +
      'background:radial-gradient(circle at 35% 30%,#fff3b0,' + acc + ' 45%,#6b4f00 100%);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.7),inset 0 -3px 8px rgba(0,0,0,.35),0 0 0 3px #1a1200;display:flex;align-items:center;justify-content:center;">' +
      '<img src="/images/soporte-1girox.png" alt="" style="width:' + Math.round(hub * 0.66) + 'px;height:' + Math.round(hub * 0.66) + 'px;border-radius:50%;object-fit:cover;border:2px solid rgba(0,0,0,.35);">' +
    '</div>' +
  '</div>';
};

/** Cierra el overlay de la ruleta. Si no es un cierre "silencioso", vuelve al
 *  inicio del asistente (donde está "🎡 Mi premio de la ruleta"). */
VIP.ui.casinoRouletteClose = function(silent) {
  const ov = document.getElementById('wrOverlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  VIP.ui._wrOverlayOpen = false;
  if (silent) return;
  if (VIP.ui._rwReturn) { VIP.ui._rwReturn = false; try { VIP.ui.openRewardsHub(); return; } catch (e) {} }
  try { VIP.ui.casinoBotGo('home'); } catch (e) {}
};

// ============================================================
// 🎁 HUB DE PREMIOS (#254) — ruleta de bienvenida + ruleta diaria + cashback
// instantáneo en un overlay propio, fuera del chat.
// ============================================================
// #291: estado del acordeón de INFORMACIÓN + toggle (re-pinta el hub).
VIP.ui._rwInfoOpen = {};
VIP.ui._rwInfoToggle = function(key) {
  VIP.ui._rwInfoOpen[key] = !VIP.ui._rwInfoOpen[key];
  const ov = document.getElementById('rwHubOverlay');
  const st = ov ? ov.scrollTop : 0;
  try { VIP.ui.openRewardsHub(); } catch (e) {}
  const ov2 = document.getElementById('rwHubOverlay');
  if (ov2) ov2.scrollTop = st;
};

VIP.ui._refreshRewards = function() {
  if (!VIP.state.currentToken) return; // invitado: sin premios
  // #290: el botón 🎁 PREMIOS se ve SIEMPRE (antes dependía de que el resumen
  // respondiera OK — en Render/entornos sin girox quedaba oculto). Si el resumen
  // falla, el hub muestra las tarjetas apagadas.
  const _btn0 = document.getElementById('casinoRewardsBtn');
  if (_btn0) _btn0.style.display = 'flex';
  fetch(`${VIP.config.API_URL}/api/rewards/summary`, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    if (!d) return;
    const changed = JSON.stringify(d) !== VIP.ui._rwSumJson;
    VIP.ui._rwSumJson = JSON.stringify(d);
    VIP.ui._rwSummary = d;
    // #295: modo de carga guardado en el server (otro dispositivo) → local.
    try { if ((d.depositMode === 'auto' || d.depositMode === 'manual') && !localStorage.getItem('vip_deposit_mode')) localStorage.setItem('vip_deposit_mode', d.depositMode); } catch (e) {}
    if (d.welcome && d.welcome.segments) VIP.ui._wrSegments = d.welcome.segments.map(function(x) { return x.label; });
    const btn = document.getElementById('casinoRewardsBtn');
    if (btn) btn.style.display = 'flex'; // el hub siempre existe (muestra "muy pronto" si algo está apagado)
    const dot = document.getElementById('rwDot');
    const claimable =
      (d.welcome && d.welcome.canSpin) ||
      (d.daily && d.daily.canSpin) ||
      (d.cashback && d.cashback.reclamable >= (d.cashback.minArs || 1) && d.cashback.reclamable > 0);
    if (dot) dot.style.display = claimable ? 'block' : 'none';
    // Re-pintar el hub SOLO si los datos cambiaron (#261): el re-armado entero
    // en medio de un deslizamiento cortaba el scroll ("se bugea al deslizar").
    if (changed && document.getElementById('rwHubOverlay')) {
      const ovh = document.getElementById('rwHubOverlay');
      const st = ovh ? ovh.scrollTop : 0;
      VIP.ui.openRewardsHub();
      const ov2 = document.getElementById('rwHubOverlay');
      if (ov2) ov2.scrollTop = st;
    }
  }).catch(function() {});
};

// #287: frase "cómo funciona" para un premio en % (ruleta bienvenida/diaria):
// tope del 100 % (hasta $X, después Y %) + rollover, con los valores reales del
// panel (vienen en /api/rewards/summary → bonusRules). Sin datos → genérico.
function _wrBonusRuleTxt(pct) {
  var br = (VIP.ui._rwSummary && VIP.ui._rwSummary.bonusRules) || null;
  var p = Number(pct) || 0, parts = [];
  // #324: el tope vale para cualquier % mayor al del excedente (misma fórmula que el server).
  if (br && br.capEnabled && br.capArs > 0 && p > (br.restPct || 0)) {
    var ej = Math.max(20000, br.capArs * 4), b1 = Math.min(ej, br.capArs) * p / 100, b2 = Math.max(0, ej - br.capArs) * (br.restPct || 0) / 100;
    parts.push('El <b>' + p + '%</b> aplica hasta <b>' + _rwFmt(br.capArs) + '</b> de tu carga; sobre lo que cargues de más te sumamos el <b>' + (br.restPct || 0) + '%</b>. ' +
      'Ej.: cargás ' + _rwFmt(ej) + ' → <b>' + _rwFmt(Math.round(b1 + b2)) + ' de bono</b>.');
  } else if (p > 0) {
    parts.push('Te sumamos el <b>' + p + '%</b> de lo que cargues.');
  }
  if (br && br.rolloverX != null) {
    parts.push(br.rolloverX > 0
      ? 'Entra como bono con <b>ROLLOVER x' + br.rolloverX + '</b>: se juega al instante y se retira después de apostar ' + br.rolloverX + ' veces el bono.'
      : 'Entra como bono <b>sin rollover</b>.');
  }
  return parts.length ? '<div style="font-size:12px;opacity:.85;margin-top:8px;line-height:1.45;">🎁 <b>Cómo funciona:</b> ' + parts.join(' ') + '</div>' : '';
}
// #285: bloque "🎁 BONOS" del recuadro INFORMACIÓN — reglas reales del panel.
function _rwBonusRulesHtml(br, li, bodyOnly) {
  if (!br) return '';
  var out = bodyOnly ? '' : '<div style="font-size:11px;font-weight:900;color:#26e07f;letter-spacing:0.5px;margin:12px 0 6px;">🎁 CÓMO FUNCIONAN LOS BONOS</div>';
  if (br.firstChargeEnabled && br.firstChargePct > 0) {
    out += li('💳', 'En tu <b style="color:#fff;">PRIMERA carga</b> te sumamos un <b style="color:#26e07f;">' + br.firstChargePct + '% EXTRA</b>, automático.');
  }
  if (br.capEnabled && br.capArs > 0) {
    // #324: el tope vale para cualquier %; el ejemplo usa el % del bono de primera carga.
    var pEj = (br.firstChargeEnabled && br.firstChargePct > 0) ? br.firstChargePct : 100;
    var rEj = Math.min(pEj, br.restPct || 0);
    var ej = Math.max(20000, br.capArs * 4), b1 = Math.min(ej, br.capArs) * pEj / 100, b2 = Math.max(0, ej - br.capArs) * rEj / 100;
    out += li('📏', 'El % del bono aplica <b style="color:#fff;">completo hasta ' + _rwFmt(br.capArs) + '</b> de la carga; sobre lo que cargues de más va un <b style="color:#fff;">' + (br.restPct || 0) + '%</b>. ' +
      'Ej. con el ' + pEj + '%: cargás ' + _rwFmt(ej) + ' → ' + _rwFmt(Math.round(b1)) + ' + ' + _rwFmt(Math.round(b2)) + ' = <b style="color:#26e07f;">' + _rwFmt(Math.round(b1 + b2)) + ' de bono</b>.');
  }
  if (br.rolloverX != null) {
    out += li('🎯', 'Todos los bonos (primera carga, ruletas, reembolso, regalos) tienen <b style="color:#ffd700;">ROLLOVER x' + br.rolloverX + '</b>' + (br.rolloverX > 0 ? ': se juegan al instante y se retiran después de apostar ' + br.rolloverX + ' veces su valor.' : ' (sin rollover).'));
  }
  out += li('🎡', 'La <b style="color:#fff;">ruleta de bienvenida</b> es solo para cuentas que se registraron desde la app o la landing (no para cuentas creadas por un agente).');
  return out;
}
function _rwFmt(n) { try { return '$' + Number(n || 0).toLocaleString('es-AR'); } catch (e) { return '$' + n; } }
function _rwCountdown(iso) {
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'ya mismo';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return (h > 0 ? h + ' h ' : '') + m + ' min';
  } catch (e) { return '—'; }
}
// #298: REEMBOLSOS POR PERÍODO (diario/semanal/mensual, #297) dentro del hub.
// Cuando el cashback instantáneo está APAGADO, la tarjeta "Tu Reembolso" ya no
// dice "muy pronto": muestra los tres reembolsos con su monto y el botón de
// reclamar (usa /api/refunds/status y /api/refunds/claim/{type}, mismos que el
// dashboard viejo). Si el status todavía no se cargó, lo pide y re-pinta.
function _rwUntil(iso) {
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'ya';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return d + ' d ' + h + ' h';
    return (h > 0 ? h + ' h ' : '') + m + ' min';
  } catch (e) { return '—'; }
}
function _rwPeriodRefundsBody() {
  const st = VIP.state.refundStatus;
  if (!st) {
    if (!VIP.ui._rwRefFetching && VIP.refunds && VIP.refunds.loadRefundStatus) {
      VIP.ui._rwRefFetching = true;
      VIP.refunds.loadRefundStatus().then(function() {
        VIP.ui._rwRefFetching = false;
        if (document.getElementById('rwHubOverlay')) {
          const ovh = document.getElementById('rwHubOverlay'); const stp = ovh ? ovh.scrollTop : 0;
          try { VIP.ui.openRewardsHub(); } catch (e) {}
          const ov2 = document.getElementById('rwHubOverlay'); if (ov2) ov2.scrollTop = stp;
        }
      }).catch(function() { VIP.ui._rwRefFetching = false; });
    }
    return '<div style="font-size:13px;color:#cfd6de;text-align:center;padding:8px 0;">⏳ Calculando tus reembolsos…</div>';
  }
  const rows = [
    { key: 'daily', icon: '☀️', label: 'Diario', sub: 'lo que perdiste ayer', color: '#ffd479' },
    { key: 'weekly', icon: '📆', label: 'Semanal', sub: 'semana pasada · lun y mar', color: '#c39bff' },
    { key: 'monthly', icon: '🗓️', label: 'Mensual', sub: 'mes pasado · desde el día 7', color: '#ff8a80' }
  ];
  let html = '';
  rows.forEach(function(r) {
    const d = st[r.key];
    if (!d) return;
    if (r.key === 'daily' && d.enabled === false) return;
    const amt = Number(d.potentialAmount) || 0;
    const ok = d.canClaim && amt > 0 && !d.belowMinimum;
    let status;
    if (d.needsApp) status = '<span style="color:#ffd479;font-weight:800;">📲 Necesitás la app instalada + notificaciones activas</span>';
    else if (ok) status = '<span style="color:#26e07f;font-weight:800;">¡Listo para reclamar!</span>';
    else if (amt > 0 && d.belowMinimum) status = 'Mínimo para cobrar ' + _rwFmt(d.minAmount) + (r.key === 'daily' ? ' · entra en el semanal' : '');
    // #316: no mostrar la BASE de pérdida (parecía plata a cobrar) sino lo COBRADO.
    else if (amt <= 0 && d.alreadyRefunded > 0 && d.netAmount > 0) status = '<span style="color:#7fe07f;">✅ Ya lo cobraste con tus reembolsos ' + (r.key === 'weekly' ? 'diarios' : 'diarios y semanales') + (d.alreadyPaid > 0 ? ' (' + _rwFmt(d.alreadyPaid) + ')' : '') + '</span>';
    else if (amt <= 0) status = 'Sin pérdida en el período';
    else if (d.nextClaim) status = '⏰ Disponible en ' + _rwUntil(d.nextClaim);
    else status = 'No disponible ahora';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,0.07);">' +
      '<span style="font-size:20px;flex:none;">' + r.icon + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:900;color:#fff;">' + r.label + ' <span style="font-size:10.5px;font-weight:700;color:' + r.color + ';">' + (d.percentage || 0) + '%</span></div>' +
        '<div style="font-size:10.5px;color:#9aa4b0;">' + r.sub + '</div>' +
        '<div style="font-size:11px;color:#b7c0ca;margin-top:2px;">' + status + '</div>' +
      '</div>' +
      '<div style="text-align:right;flex:none;">' +
        '<div style="font-size:17px;font-weight:900;color:' + (ok ? '#4dd0ff' : '#5a6672') + ';">' + _rwFmt(amt) + '</div>' +
        (d.needsApp
          ? '<button type="button" onclick="VIP.ui._rwShowInstallGuide()" style="margin-top:4px;border:none;cursor:pointer;background:linear-gradient(135deg,#26e07f,#0f9d58);color:#00301a;border-radius:9px;padding:7px 11px;font-size:12px;font-weight:900;">📲 Instalar</button>'
          : (ok ? '<button type="button" onclick="VIP.ui._rwClaimRefund(\'' + r.key + '\')" style="margin-top:4px;border:none;cursor:pointer;background:linear-gradient(135deg,#4dd0ff,#1e88e5);color:#00223a;border-radius:9px;padding:7px 11px;font-size:12px;font-weight:900;">💸 Reclamar</button>' : '')) +
      '</div>' +
    '</div>';
  });
  if (html && st.appInstalled === false) {
    html = '<div style="font-size:12px;color:#ffd479;background:rgba(255,212,121,0.08);border:1px solid rgba(255,212,121,0.3);border-radius:10px;padding:8px 10px;margin-bottom:4px;line-height:1.45;">📲 Para reclamar reembolsos necesitás <b>2 cosas</b>: ① la <b>app instalada</b> (agregada a la pantalla de inicio) y ② las <b>notificaciones activadas</b> dentro de la app. Con una sola no alcanza. Tocá <b>Instalar</b> y te guiamos paso a paso.</div>' + html;
  }
  return html || '<div style="font-size:13px;color:#9aa4b0;">Por ahora no hay reembolsos activos.</div>';
}
VIP.ui._rwClaimRefund = function(type) {
  if (VIP.ui._rwClaiming) return;
  VIP.ui._rwClaiming = true;
  fetch(`${VIP.config.API_URL}/api/refunds/claim/${type}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(function(r) { return r.json(); }).then(function(d) {
    VIP.ui._rwClaiming = false;
    if (d && d.success) {
      VIP.ui.showToast('🎉 ' + (d.message || 'Reembolso acreditado'), 'success');
      try { VIP.ui._playChime(); } catch (e) {}
    } else {
      VIP.ui.showToast((d && d.message) || 'No se pudo reclamar', 'error');
    }
    if (VIP.refunds && VIP.refunds.loadRefundStatus) {
      VIP.refunds.loadRefundStatus().then(function() {
        if (document.getElementById('rwHubOverlay')) {
          const ovh = document.getElementById('rwHubOverlay'); const stp = ovh ? ovh.scrollTop : 0;
          try { VIP.ui.openRewardsHub(); } catch (e) {}
          const ov2 = document.getElementById('rwHubOverlay'); if (ov2) ov2.scrollTop = stp;
        }
      }).catch(function() {});
    }
  }).catch(function() { VIP.ui._rwClaiming = false; VIP.ui.showToast('Error de conexión', 'error'); });
};

function _rwCard(opts) {
  // Tarjeta del hub: ícono + título + estado + CTA. Diseño oscuro con acento.
  const acc = opts.accent || '#ffd700';
  return '<div style="background:linear-gradient(160deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015));' +
      'border:1px solid ' + acc + '55;border-radius:18px;padding:16px 16px 14px;position:relative;overflow:hidden;">' +
    '<div style="position:absolute;top:-30px;right:-30px;width:110px;height:110px;border-radius:50%;background:' + acc + '14;"></div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
      '<div style="width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;' +
        'font-size:24px;background:' + acc + '1f;border:1px solid ' + acc + '44;flex:none;">' + opts.icon + '</div>' +
      '<div style="min-width:0;">' +
        '<div style="font-size:15px;font-weight:900;color:#fff;letter-spacing:0.2px;">' + opts.title + '</div>' +
        '<div style="font-size:11.5px;color:#9aa4b0;">' + (opts.subtitle || '') + '</div>' +
      '</div>' +
    '</div>' +
    (opts.body || '') +
    (opts.cta || '') +
  '</div>';
}
function _rwCta(label, onclick, enabled, accent) {
  const acc = accent || '#ffd700';
  if (enabled) {
    return '<button type="button" onclick="' + onclick + '" style="width:100%;margin-top:10px;border:none;cursor:pointer;' +
      'background:linear-gradient(135deg,' + acc + ',#ff9800);color:#231a00;border-radius:13px;padding:13px;' +
      'font-size:15px;font-weight:900;letter-spacing:0.3px;box-shadow:0 6px 18px ' + acc + '40;">' + label + '</button>';
  }
  return '<div style="width:100%;margin-top:10px;text-align:center;background:rgba(255,255,255,0.06);color:#8b95a1;' +
    'border-radius:13px;padding:12px;font-size:13px;font-weight:700;">' + label + '</div>';
}

// ============================================================
// #308: REFERIDOS en el hub PREMIOS (owner 2026-09-28: "que se le explique,
// incentivar, en segundo plano pero que llame la atención"). Tarjeta al final de
// los premios (antes de INFORMACIÓN) con link para compartir + WhatsApp, cuánto
// gana, referidos activos y último pago. Datos de /api/referrals/me + /summary,
// cacheados en VIP.ui._rwRef (se piden la primera vez y se re-pinta el hub).
// ============================================================
VIP.ui._rwLoadReferrals = function() {
  if (VIP.ui._rwRefFetching) return;
  VIP.ui._rwRefFetching = true;
  const h = { 'Authorization': `Bearer ${VIP.state.currentToken}` };
  Promise.all([
    fetch(`${VIP.config.API_URL}/api/referrals/me`, { headers: h }).then(function(r) { return r.ok ? r.json() : null; }),
    fetch(`${VIP.config.API_URL}/api/referrals/summary`, { headers: h }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
  ]).then(function(res) {
    VIP.ui._rwRefFetching = false;
    VIP.ui._rwRef = { me: (res[0] && res[0].data) || null, sum: (res[1] && res[1].data) || null, at: Date.now() };
    if (document.getElementById('rwHubOverlay')) {
      const ovh = document.getElementById('rwHubOverlay'); const stp = ovh ? ovh.scrollTop : 0;
      try { VIP.ui.openRewardsHub(); } catch (e) {}
      const ov2 = document.getElementById('rwHubOverlay'); if (ov2) ov2.scrollTop = stp;
    }
  }).catch(function() { VIP.ui._rwRefFetching = false; VIP.ui._rwRef = { me: null, sum: null, err: true, at: Date.now() }; });
};
VIP.ui._rwRefPct = function() {
  const p = VIP.ui._rwSummary && Number(VIP.ui._rwSummary.referralPct);
  return (p > 0) ? p : 3;
};
// #317: con NIVELES (referidos activos) el % del copy es el MÁXIMO alcanzable → "hasta el X%".
VIP.ui._rwRefPctTxt = function() {
  const tiers = !!(VIP.ui._rwSummary && VIP.ui._rwSummary.referralTiersOn);
  return (tiers ? 'hasta el ' : 'el ') + VIP.ui._rwRefPct() + '%';
};
VIP.ui._rwRefShareText = function() {
  const me = (VIP.ui._rwRef && VIP.ui._rwRef.me) || {};
  // #308b: plantilla editable en COMANDOS (/sys_referidos_compartir) vía el summary.
  let tpl = (VIP.ui._rwSummary && VIP.ui._rwSummary.referralShareTpl) || '🎰 Sumate a la sala con mi link y jugá con cargas automáticas en segundos 👉 {link}';
  tpl = String(tpl).replace(/\{link\}/g, me.referralLink || '').replace(/\{codigo\}/g, me.referralCode || '').replace(/\{pct\}/g, String(VIP.ui._rwRefPct()));
  if (me.referralLink && tpl.indexOf(me.referralLink) === -1) tpl += ' ' + me.referralLink; // que nunca salga sin el link
  return tpl;
};
VIP.ui._rwCopyRef = function() {
  const me = (VIP.ui._rwRef && VIP.ui._rwRef.me) || {};
  const val = me.referralLink || me.referralCode || '';
  if (!val) return;
  const ok = function() { VIP.ui.showToast('✅ Link copiado — compartilo con tus amigos', 'success'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(val).then(ok, function() { window.prompt('Copialo manualmente:', val); }); return; }
  } catch (e) {}
  window.prompt('Copialo manualmente:', val);
};
VIP.ui._rwShareRef = function() {
  const txt = VIP.ui._rwRefShareText();
  try {
    if (navigator.share) { navigator.share({ text: txt }).catch(function() {}); return; }
  } catch (e) {}
  window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
};
// #308c: botón "Invitá amigos" del inicio del asistente → COPIA el link al toque
// y ofrece cómo mandarlo (WhatsApp / otras apps / ver referidos). Si el link
// todavía no se cargó, lo pide y reintenta solo.
VIP.ui._rwInviteFriends = function() {
  const me = (VIP.ui._rwRef && VIP.ui._rwRef.me) || null;
  if (!me || !me.referralLink) {
    VIP.ui.showToast('⏳ Preparando tu link…', 'info');
    const h = { 'Authorization': `Bearer ${VIP.state.currentToken}` };
    fetch(`${VIP.config.API_URL}/api/referrals/me`, { headers: h }).then(function(r) { return r.ok ? r.json() : null; }).then(function(j) {
      VIP.ui._rwRef = Object.assign({}, VIP.ui._rwRef || {}, { me: (j && j.data) || null, at: Date.now() });
      if (VIP.ui._rwRef.me && VIP.ui._rwRef.me.referralLink) VIP.ui._rwInviteFriends();
      else VIP.ui.showToast('No pudimos traer tu link. Probá de nuevo.', 'error');
    }).catch(function() { VIP.ui.showToast('Error de conexión', 'error'); });
    return;
  }
  // 1) copiar
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(me.referralLink).catch(function() {}); } catch (e) {}
  // 2) opciones en el hilo del asistente
  const area = document.getElementById('casinoBotArea');
  if (!area) { VIP.ui._rwShareRef(); return; }
  const old = document.getElementById('botInviteBlock'); if (old) old.remove();
  const oldRow = document.getElementById('botInviteRow'); if (oldRow) oldRow.remove();
  const b = VIP.ui._botMsg('✅ <b>Link copiado</b> — ya lo podés pegar donde quieras.<br>' +
    '<div class="cwBox" style="border-radius:9px;padding:7px 9px;margin-top:6px;font-size:11.5px;font-family:monospace;word-break:break-all;">' + _wrEsc(me.referralLink) + '</div>' +
    '<div style="margin-top:6px;">¿Cómo querés invitarlos? Cobrás <b>' + VIP.ui._rwRefPctTxt() + '</b> de comisión por su actividad, todos los meses.</div>');
  if (b) b.id = 'botInviteBlock';
  const hasShare = (function() { try { return !!navigator.share; } catch (e) { return false; } })();
  VIP.ui._botRow(
    VIP.ui._botBtn('💬 Enviar por WhatsApp', "VIP.ui._rwShareWa()", true) +
    (hasShare ? VIP.ui._botBtn('📤 Otras apps', "VIP.ui._rwShareRef()") : '') +
    VIP.ui._botBtn('📋 Copiar de nuevo', "VIP.ui._rwCopyRef()") +
    VIP.ui._botBtn('🤝 Ver mis referidos', "VIP.ui.openReferralModal()")
  );
  const row = area.lastElementChild; if (row) row.id = 'botInviteRow';
};
// WhatsApp directo (elegir contacto o grupo desde la app), sin pasar por el share nativo.
VIP.ui._rwShareWa = function() {
  window.open('https://wa.me/?text=' + encodeURIComponent(VIP.ui._rwRefShareText()), '_blank');
};

VIP.ui._rwReferralCard = function() {
  const pct = VIP.ui._rwRefPct();
  const acc = '#ff9800';
  const ref = VIP.ui._rwRef;
  if (!ref) { VIP.ui._rwLoadReferrals(); }
  const me = (ref && ref.me) || null, sum = (ref && ref.sum) || null;
  const _tiersOn = !!(VIP.ui._rwSummary && VIP.ui._rwSummary.referralTiersOn);
  const _myPct = VIP.ui._rwSummary && VIP.ui._rwSummary.referralMyPct;
  const head = '<div style="font-size:13.5px;color:#fff;line-height:1.45;margin-bottom:8px;">Compartí tu link: cada amigo que se registre con él es <b>tu referido</b>, y vos cobrás ' +
    '<b style="color:' + acc + ';">una comisión de ' + VIP.ui._rwRefPctTxt() + ' por su actividad</b>, <b>todos los meses</b>, directo a tu saldo. Sin límite de amigos. 🚀</div>' +
    // #317: niveles por referidos activos → el % propio y el botón al tablero completo.
    (_tiersOn ? '<div style="font-size:12px;color:#cfd6de;margin:-2px 0 8px;">🏆 Tu % actual: <b style="color:#26e07f;">' + (_myPct != null ? _myPct : 0) + '%</b> · cuantos más amigos <b>activos</b>, más % cobrás.</div>' : '') +
    '<button type="button" onclick="VIP.ui.openReferralModal()" style="width:100%;border:1px solid ' + acc + '88;cursor:pointer;background:rgba(255,152,0,0.10);color:#fff;border-radius:11px;padding:10px;font-size:13px;font-weight:800;margin-bottom:8px;">📊 Ver mis referidos y mi nivel</button>';
  let body;
  if (!ref) {
    body = head + '<div style="font-size:12.5px;color:#9aa4b0;">⏳ Cargando tu link…</div>';
  } else if (!me) {
    body = head + '<div style="font-size:12.5px;color:#cfd6de;">No pudimos traer tu link ahora. <span onclick="VIP.ui._rwRef=null;VIP.ui._rwLoadReferrals()" style="color:' + acc + ';font-weight:800;cursor:pointer;">Reintentar</span></div>';
  } else {
    const link = me.referralLink || '';
    const activos = me.activeReferred != null ? me.activeReferred : (me.totalReferred || 0);
    const cobrado = Math.round(me.historicalTotalCredited || 0);
    const estim = sum ? Math.round(sum.pendingEstimatedAmount || 0) : 0;
    const stat = function(lbl, val, color) {
      return '<div style="flex:1;min-width:80px;background:rgba(255,255,255,0.05);border-radius:10px;padding:7px 8px;text-align:center;">' +
        '<div style="font-size:10px;color:#9aa4b0;letter-spacing:.3px;">' + lbl + '</div><div style="font-size:15px;font-weight:900;color:' + (color || '#fff') + ';">' + val + '</div></div>';
    };
    body = head +
      '<div style="background:rgba(0,0,0,0.30);border:1px dashed ' + acc + '88;border-radius:12px;padding:9px 10px;margin-bottom:8px;">' +
        '<div style="font-size:10px;color:#9aa4b0;letter-spacing:.5px;margin-bottom:3px;">TU LINK DE INVITACIÓN · código <b style="color:#fff;">' + _wrEsc(me.referralCode || '—') + '</b></div>' +
        '<div style="font-size:12px;color:#fff;word-break:break-all;font-family:monospace;">' + _wrEsc(link || '—') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<button type="button" onclick="VIP.ui._rwCopyRef()" style="flex:1;border:none;cursor:pointer;background:rgba(255,255,255,0.10);color:#fff;border-radius:11px;padding:11px;font-size:13px;font-weight:800;">📋 Copiar link</button>' +
        '<button type="button" onclick="VIP.ui._rwShareWa()" style="flex:1.2;border:none;cursor:pointer;background:linear-gradient(135deg,#25d366,#128c4a);color:#fff;border-radius:11px;padding:11px;font-size:13px;font-weight:900;box-shadow:0 6px 16px rgba(37,211,102,0.3);">💬 Enviar por WhatsApp</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        stat('REFERIDOS', activos, activos > 0 ? '#26e07f' : '#fff') +
        stat('COBRADO', _rwFmt(cobrado), cobrado > 0 ? acc : '#fff') +
        stat('ESTE MES', _rwFmt(estim), estim > 0 ? acc : '#fff') +
      '</div>' +
      '<div style="font-size:11px;color:#9aa4b0;margin-top:8px;text-align:center;">💸 Se paga solo el <b style="color:#fff;">1 de cada mes</b>' + (sum && sum.lastPayout && sum.lastPayout.amount > 0 ? ' · último pago <b style="color:#fff;">' + _rwFmt(sum.lastPayout.amount) + '</b>' : '') + '</div>';
  }
  return '<div id="rwRefCard">' + _rwCard({ icon: '🤝', accent: acc, title: 'Invitá y ganá', subtitle: 'Comisión de ' + VIP.ui._rwRefPctTxt() + ' por la actividad de tus referidos, cada mes', body: body, cta: '' }) + '</div>';
};

VIP.ui.openRewardsHub = function(focus) {
  VIP.ui.closeRewardsHub(true);
  const d = VIP.ui._rwSummary || {};
  const w = d.welcome || {}, dy = d.daily || {}, cb = d.cashback || {};
  let cards = '';

  // --- Ruleta de BIENVENIDA — solo mientras haya algo que hacer (owner
  // 2026-09-02): con el giro disponible, o con el % pendiente de usar. Una vez
  // RECLAMADO/aplicado el premio, la tarjeta desaparece del hub.
  {
    let body = '', cta = '';
    const wPending = w.prize && w.prize.type === 'percent' && w.prize.status === 'pending';
    if (w.ineligible === 'manual') {
      // #285: cuenta creada por un agente → sin ruleta de bienvenida (sin tarjeta).
    } else if (w.canSpin) {
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.4;">Tenés <b style="color:#ffd700;">1 giro GRATIS</b> de bienvenida. Se gira una sola vez. ¡Suerte!</div>';
      cta = _rwCta('🎡 GIRAR AHORA', "VIP.ui._rwSpinWelcome()", true);
    } else if (wPending) {
      const p = w.prize;
      body = '<div style="font-size:13px;color:#cfd6de;">Tu premio: <b style="color:#ffd700;font-size:16px;">' + _wrEsc(p.label || '') + '</b><br>' +
        '<span style="font-size:12px;">⏳ ' + _wrEsc(String(p.value)) + '% EXTRA pendiente — se suma en tu próxima carga</span>' + _wrBonusRuleTxt(p.value) + '</div>';
      cta = _rwCta('💳 Cargar y usarlo', "VIP.ui.closeRewardsHub();VIP.ui.casinoBotGo('deposit')", true);
    } else if (w.prize && w.prize.status === 'used' && w.prize.usedBy === 'bono 1ª carga') {
      // #286: no giró, pero cobró el 100% de primera carga → es el mismo regalo.
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.45;">Tu bono de bienvenida (<b style="color:#ffd700;">' + _wrEsc(w.prize.label || '100%') + '</b>) ' +
        '<b style="color:#26e07f;">ya se aplicó en tu primera carga</b> 🎉. Es un solo regalo de bienvenida por cuenta, por eso la ruleta queda usada.</div>';
      cta = _rwCta('✅ Bono de bienvenida usado', '', false);
    } else if (!w.prize && !w.enabled) {
      body = '<div style="font-size:13px;color:#9aa4b0;">Un giro gratis al crear tu cuenta. 🔒 Disponible muy pronto.</div>';
      cta = _rwCta('🔒 Muy pronto', '', false);
    }
    // Premio ya usado/acreditado (o giró y no quedó nada pendiente) → sin tarjeta.
    if (body || cta) {
      cards += _rwCard({ icon: '🎡', accent: '#ffd700', title: 'Ruleta de Bienvenida', subtitle: 'Un giro único por cuenta', body: body, cta: cta });
    }
  }

  // --- Ruleta DIARIA (siempre visible; apagada = "muy pronto") ---
  {
    let body = '', cta = '';
    if (!dy.enabled) {
      body = '<div style="font-size:13px;color:#9aa4b0;">Un giro gratis TODOS los días con premios en % extra y saldo. 🔒 Disponible muy pronto.</div>';
      cta = _rwCta('🔒 Muy pronto', '', false, '#26e07f');
    } else if (dy.canSpin) {
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.4;">Tu giro <b style="color:#26e07f;">GRATIS de HOY</b> está disponible. Premios en % extra (reclamable por <b>24 h</b> en tu próxima carga) y saldo directo.</div>';
      cta = _rwCta('🎰 GIRAR LA RULETA DE HOY', 'VIP.ui._rwSpinDaily()', true, '#26e07f');
    } else if (dy.needsDeposit) {
      // #306: el requisito es tener carga en los últimos N días (no histórica).
      const _dd = Number(dy.depositDays) || 0;
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.4;">' + (_dd > 0
        ? 'Para girar necesitás <b>una carga en los últimos ' + _dd + ' días</b>. Cargá y desbloqueás un giro gratis <b>todos los días</b>.'
        : 'Hacé tu <b>primera carga</b> y desbloqueás un giro gratis <b>todos los días</b>.') + '</div>';
      cta = _rwCta(_dd > 0 ? '💳 Cargar y activar mi giro' : '💳 Hacer mi primera carga', "VIP.ui.closeRewardsHub();VIP.ui.casinoBotGo('deposit')", true, '#26e07f');
    } else if (dy.alreadySpun) {
      const tp = dy.todayPrize || {};
      let st = tp.type === 'percent' ? ('Hoy ganaste <b style="color:#26e07f;">' + _wrEsc(tp.label || '') + '</b>' + (dy.pendingPct > 0 ? ' — se aplica en tu próxima carga · <b style="color:#ffd700;">vence en ' + _rwCountdown(dy.pendingExpiresAt) + '</b> ⏳' : ' — ya aplicado o vencido'))
        : tp.type === 'cash' && tp.prizeARS > 0 ? ('Hoy ganaste <b style="color:#26e07f;">' + _rwFmt(tp.prizeARS) + '</b> — acreditado 💰')
        : 'Hoy no hubo suerte 😅';
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.45;">' + st + '<br>' +
        '<span style="font-size:12px;color:#9aa4b0;">⏰ Próximo giro en <b>' + _rwCountdown(dy.nextResetAt) + '</b> (24 h desde tu último giro)</span></div>';
      cta = _rwCta('⏰ Próximo giro en ' + _rwCountdown(dy.nextResetAt), '', false);
    } else if (dy.needsApp) {
      body = '<div style="font-size:13px;color:#cfd6de;line-height:1.4;">📲 El giro diario se activa con <b>2 cosas</b>: ① la <b>app instalada</b> (agregada al inicio) y ② las <b>notificaciones aceptadas</b> dentro de la app. Con una sola no alcanza.</div>';
      // Guía PROPIA del hub (#256c): la vieja (installApp) dibujaba su cartel
      // DEBAJO del overlay del casino y no se veía nada.
      // #272: si la app ya está instalada y SOLO faltan las notificaciones, el
      // CTA es la campana (un toque → cartel Permitir), sin pasar por la guía.
      let _inst = false, _perm = 'default';
      try { _inst = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (e) {}
      try { _perm = Notification.permission; } catch (e) {}
      cta = (_inst && _perm === 'default')
        ? _rwCta('🔔 Activar notificaciones (1 toque)', 'VIP.ui._rwShowInstallGuide();VIP.ui._rwEnableNotifs(document.getElementById(\'rwBellBtn\'))', true, '#53bdeb')
        : _rwCta('📲 Instalar la app — ver cómo', 'VIP.ui._rwShowInstallGuide()', true, '#26e07f');
    } else {
      body = '<div style="font-size:13px;color:#cfd6de;">La ruleta diaria no está disponible para tu cuenta todavía.</div>';
    }
    cards += _rwCard({ icon: '🎰', accent: '#26e07f', title: 'Ruleta Diaria', subtitle: 'Un giro gratis por día', body: body, cta: cta });
  }

  // --- CASHBACK instantáneo (siempre visible; apagado = "muy pronto") ---
  {
    let body = '', cta = '';
    // "En vivo" (#254): sello de frescura + refresco manual. El auto-refresh
    // corre cada 60s mientras el hub está abierto (_rwStartPolling).
    const _cbAgo = VIP.ui._rwCbAt ? Math.max(0, Math.round((Date.now() - VIP.ui._rwCbAt) / 1000)) : null;
    const _cbLive = cb.enabled && !cb.unavailable
      ? '<div style="display:flex;align-items:center;justify-content:space-between;margin:-2px 0 6px;">' +
          '<span style="font-size:10.5px;color:#6f7a86;">' +
            '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#26e07f;box-shadow:0 0 6px #26e07f;margin-right:4px;"></span>' +
            'EN VIVO' + (_cbAgo != null ? ' · actualizado hace ' + (_cbAgo < 5 ? 'instantes' : _cbAgo + ' s') : '') + '</span>' +
          '<button type="button" onclick="VIP.ui._rwPollCashback(true)" style="background:rgba(255,255,255,0.10);border:none;color:#cfd6de;' +
            'border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;">🔄 Actualizar</button>' +
        '</div>'
      : '';
    // UNA sola idea, sin jerga (owner 2026-09-03): "esto es TU reembolso, lo
    // tocás y entra YA". El monto grande siempre visible (aunque sea $0).
    if (!cb.enabled) {
      // #298: sin cashback instantáneo → los reembolsos por período (diario /
      // semanal / mensual) viven acá, con reclamo directo.
      body = _rwPeriodRefundsBody();
      cta = '';
    } else if (cb.unavailable) {
      body = '<div style="font-size:13px;color:#cfd6de;">No pudimos calcular tu reembolso ahora. Probá en unos minutos.</div>';
    } else {
      const ok = cb.reclamable > 0 && cb.reclamable >= (cb.minArs || 0);
      body = '<div style="text-align:center;padding:4px 0 2px;">' +
        '<div style="font-size:11.5px;color:#9aa4b0;">TU REEMBOLSO DISPONIBLE</div>' +
        '<div style="font-size:34px;font-weight:900;color:' + (ok ? '#4dd0ff' : '#5a6672') + ';text-shadow:0 2px 8px rgba(77,208,255,0.25);margin:2px 0;">' + _rwFmt(cb.reclamable) + '</div>' +
        (ok
          ? '<div style="font-size:11.5px;color:#9aa4b0;">Tocá RECLAMAR y entra <b style="color:#fff;">YA</b> a tu saldo.<br>O seguí juntando — no se vence.</div>'
          : (cb.reclamable > 0
              ? '<div style="font-size:11.5px;color:#9aa4b0;">Se reclama desde ' + _rwFmt(cb.minArs) + '. Seguí jugando: se junta solo.</div>'
              : '<div style="font-size:11.5px;color:#9aa4b0;">Se va juntando solo a medida que jugás: el ' + (cb.pct || 0) + '% de lo que perdés vuelve acá.</div>')) +
        '</div>';
      if (ok) cta = _rwCta('💸 RECLAMAR ' + _rwFmt(cb.reclamable) + ' AHORA', 'VIP.ui.casinoCashbackClaim()', true, '#4dd0ff');
    }
    body = _cbLive + body;
    cards += _rwCard({ icon: '💸', accent: '#4dd0ff', title: cb.enabled ? 'Tu Reembolso' : 'Tus Reembolsos', subtitle: cb.enabled ? ('El ' + (cb.pct || 0) + '% de lo que perdés vuelve a tu saldo') : 'Diario, semanal y mensual — sobre lo que perdés jugando', body: body, cta: cta });
  }

  // --- 🤝 REFERIDOS (#308): segundo plano (al final de los premios) pero visible.
  try { cards += VIP.ui._rwReferralCard(); } catch (e) {}

  // --- ℹ️ SECCIÓN INFORMACIÓN (#257d): reembolso + rollover explicado todo
  // junto, con los VALORES REALES del panel (pct / mínimo / tope / rollover). ---
  {
    const iPct = (cb && cb.pct) || 5;
    const iMin = (cb && cb.minArs) || 0;
    const iMax = (cb && cb.maxDailyArs) || 0;
    const iRoll = (cb && cb.rolloverX) || 0;
    const li = function(emoji, html) {
      return '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">' +
        '<span style="flex:none;font-size:14px;">' + emoji + '</span>' +
        '<span style="font-size:12px;color:#b7c0ca;line-height:1.55;">' + html + '</span></div>';
    };
    // #291: ACORDEÓN — cada tema cerrado por defecto; se abre/cierra al tocar
    // (estado en VIP.ui._rwInfoOpen para sobrevivir al re-render del hub).
    const sec = function(key, color, title, body) {
      const open = !!(VIP.ui._rwInfoOpen && VIP.ui._rwInfoOpen[key]);
      return '<div style="border-top:1px solid rgba(255,255,255,0.08);">' +
        '<button type="button" onclick="VIP.ui._rwInfoToggle(\'' + key + '\')" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;' +
          'background:none;border:none;padding:11px 0;cursor:pointer;text-align:left;">' +
          '<span style="font-size:11.5px;font-weight:900;color:' + color + ';letter-spacing:0.5px;">' + title + '</span>' +
          '<span style="color:#9aa4b0;font-size:13px;transition:transform .2s;transform:rotate(' + (open ? 90 : 0) + 'deg);">▶</span>' +
        '</button>' +
        '<div style="display:' + (open ? 'block' : 'none') + ';padding:0 0 8px;">' + body + '</div>' +
      '</div>';
    };
    const _rs = VIP.state.refundStatus || {};
    const _pctTxt = function(k) { const t = _rs[k] && _rs[k].tier; return t ? ('hasta el ' + t.pct + '%') : ''; };
    const secReembolso = (cb && cb.enabled) ? (
      li('🔄', 'Te devolvemos el <b style="color:#fff;">' + iPct + '%</b> de lo que perdés jugando. Se va <b style="color:#fff;">juntando solo</b> y <b style="color:#fff;">no se vence</b>.') +
      li('👆', 'Lo reclamás <b style="color:#fff;">cuando quieras</b>' + (iMin > 0 ? ' (desde ' + _rwFmt(iMin) + ')' : '') + ' o seguís juntándolo — vos elegís.') +
      (iMax > 0 ? li('📅', 'Tope: podés reclamar hasta <b style="color:#fff;">' + _rwFmt(iMax) + ' por día</b>.') : '') +
      li('⚽', '<b style="color:#ff8a80;">DEPORTES NO genera reembolso</b>: solo cuenta lo que jugás en <b style="color:#26e07f;">slots y casino</b>.') +
      li('⚡', 'Al reclamar, entra <b style="color:#fff;">YA</b> a tu saldo como <b style="color:#fff;">BONUS</b> y podés jugarlo al instante.')
    ) : (
      // #298: reembolsos por período (#297).
      li('☀️', '<b style="color:#fff;">Diario:</b> todos los días reclamás lo que perdiste <b style="color:#fff;">ayer</b>. Día por día: lo de ayer no depende de otros días.') +
      li('📆', '<b style="color:#fff;">Semanal:</b> lunes y martes reclamás la pérdida de la <b style="color:#fff;">semana pasada</b> (se restan tus ganancias de esa semana).') +
      li('🗓️', '<b style="color:#fff;">Mensual:</b> desde el día 7 reclamás la pérdida del <b style="color:#fff;">mes pasado</b>.') +
      li('1️⃣', 'Cada pérdida se reembolsa <b style="color:#fff;">una sola vez</b>: lo que ya cobraste con el diario se descuenta del semanal, y lo del diario y semanal, del mensual. Si un día no reclamás el diario, no lo perdés: entra en el semanal.') +
      li('📈', 'Cuanto más perdés en el período, mayor el %. Tocá tu USUARIO en la app para ver la escala completa.') +
      li('📲', 'Se reclaman <b style="color:#fff;">desde la app instalada</b> y con las <b style="color:#fff;">notificaciones activadas</b> — las dos cosas, igual que la ruleta diaria.') +
      li('⚽', '<b style="color:#ff8a80;">DEPORTES NO genera reembolso</b>: solo cuenta lo que jugás en <b style="color:#26e07f;">slots y casino</b>.') +
      li('⚡', 'Al reclamar, entra <b style="color:#fff;">YA</b> a tu saldo como <b style="color:#fff;">BONUS</b>.')
    );
    const secRollover =
      li('🎯', 'Para <b style="color:#fff;">RETIRAR</b> un bonus, primero tenés que <b style="color:#fff;">apostarlo la cantidad de veces que indica</b>. ' +
        (iRoll > 0
          ? 'Acá es <b style="color:#ffd700;">x' + iRoll + '</b>: reclamás $1.000 → apostás $' + (1000 * iRoll).toLocaleString('es-AR') + ' y lo retirás sin problema.'
          : 'Ej.: <b style="color:#ffd700;">x2</b> = reclamás $1.000 → apostás $2.000 y lo retirás sin problema.')) +
      li('🎰', 'El rollover se completa con <b style="color:#26e07f;">cualquier apuesta</b>: slots, casino en vivo y también <b style="color:#26e07f;">deportes</b>.') +
      li('💡', 'Mientras completás el rollover, la plata está en tu saldo y jugás normal. Solo afecta el momento de retirar.');
    const secBonos = _rwBonusRulesHtml(d.bonusRules, li, true);
    cards += '<div style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:12px 16px 4px;">' +
      '<div style="font-size:13.5px;font-weight:900;color:#fff;margin-bottom:6px;">ℹ️ INFORMACIÓN <span style="font-weight:600;color:#9aa4b0;font-size:11px;">— tocá un tema para abrirlo</span></div>' +
      sec('reembolso', '#4dd0ff', '💸 CÓMO FUNCIONA TU REEMBOLSO', secReembolso) +
      sec('rollover', '#ffd700', '🔒 ¿QUÉ ES EL ROLLOVER?', secRollover) +
      (secBonos ? sec('bonos', '#26e07f', '🎁 CÓMO FUNCIONAN LOS BONOS', secBonos) : '') +
      sec('referidos', '#ff9800', '🤝 CÓMO FUNCIONAN LOS REFERIDOS',
        li('🔗', 'Compartí <b style="color:#fff;">tu link</b> (está en la tarjeta "Invitá y ganá"). El que se registra con él queda como <b style="color:#fff;">tu referido</b> para siempre.') +
        li('💰', 'Cada mes cobrás una <b style="color:#fff;">comisión de <span style="color:#ff9800;">' + VIP.ui._rwRefPctTxt() + '</span></b> por la actividad de tus referidos en la sala. ' + ((VIP.ui._rwSummary && VIP.ui._rwSummary.referralTiersOn) ? 'Tu % sube con la cantidad de amigos <b style="color:#fff;">activos</b> (los que cargaron).' : 'Cuantos más amigos invites, más cobrás — sin tope.')) +
        li('📅', 'Se acredita <b style="color:#fff;">solo, el 1 de cada mes</b>, directo a tu saldo y sin rollover: lo podés jugar o retirar al instante.') +
        li('📊', 'En la tarjeta ves tus referidos activos, lo que ya cobraste y lo estimado del mes en curso.')) +
    '</div>';
  }

  if (!cards) cards = '<div style="color:#9aa4b0;text-align:center;padding:30px 10px;font-size:14px;">Por ahora no hay premios activos. ¡Volvé pronto! 🎁</div>';

  const ov = document.createElement('div');
  ov.id = 'rwHubOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147482900;display:flex;flex-direction:column;align-items:center;' +
    'background:radial-gradient(120% 90% at 50% 0%,#141b2e 0%,#0a0e1a 55%,#070a12 100%);' +
    'overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;' +
    'padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px));box-sizing:border-box;';
  ov.innerHTML =
    '<button type="button" onclick="VIP.ui.closeRewardsHub()" aria-label="Cerrar" ' +
      'style="position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:12px;width:38px;height:38px;border-radius:50%;' +
      'border:none;background:rgba(255,255,255,.12);color:#fff;font-size:19px;font-weight:900;cursor:pointer;">✕</button>' +
    '<div style="width:100%;max-width:420px;">' +
      '<div style="text-align:center;margin:6px 0 18px;">' +
        '<div style="font-size:34px;line-height:1;">🎁</div>' +
        '<div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.5px;margin-top:4px;">TUS PREMIOS</div>' +
        '<div style="font-size:12px;color:#9aa4b0;margin-top:2px;">Ruletas, bonos y reembolsos — todo acá</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:14px;">' + cards + '</div>' +
    '</div>';
  document.body.appendChild(ov);
  // #308: abierto desde el banner "Invitá y ganá" → scroll a la tarjeta de referidos.
  if (focus === 'ref') { try { const c = document.getElementById('rwRefCard'); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} }
  // Arrancar el polling solo si no está corriendo (el re-render del propio
  // polling vuelve a pasar por acá y no debe reiniciar el timer ni re-pedir).
  if (!VIP.ui._rwPollTimer) VIP.ui._rwStartPolling();
};
VIP.ui.closeRewardsHub = function(silent) {
  const ov = document.getElementById('rwHubOverlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  VIP.ui._rwStopPolling();
  if (!silent) { try { VIP.ui._refreshRewards(); } catch (e) {} }
};

// ---- CASHBACK "EN VIVO" (#254): auto-refresh SOLO mientras el hub está
// abierto y la pestaña visible. Cada 60s pide /api/cashback/status; el server
// cachea el netwin 90s → como mucho UNA consulta real a la plataforma por
// cliente cada minuto y medio (no come el rate limit de 60/min). ----
VIP.ui._rwStartPolling = function() {
  VIP.ui._rwStopPolling();
  // 🪦 #329: el cashback instantáneo fue retirado → sin cashback habilitado no
  // hay nada que refrescar (antes pegaba a /api/cashback/status cada 60 s).
  const _cb0 = VIP.ui._rwSummary && VIP.ui._rwSummary.cashback;
  if (!_cb0 || _cb0.enabled !== true) return;
  VIP.ui._rwPollCashback();
  VIP.ui._rwPollTimer = setInterval(function() {
    if (document.hidden) return;
    if (!document.getElementById('rwHubOverlay')) { VIP.ui._rwStopPolling(); return; }
    VIP.ui._rwPollCashback();
  }, 60000);
};
VIP.ui._rwStopPolling = function() {
  if (VIP.ui._rwPollTimer) { clearInterval(VIP.ui._rwPollTimer); VIP.ui._rwPollTimer = null; }
};
VIP.ui._rwPollCashback = function(manual) {
  if (VIP.ui._rwPollBusy) return;
  VIP.ui._rwPollBusy = true;
  // El botón 🔄 pide con fresh=1 → el server lee el netwin SIN cache (una vez
  // cada 30s por usuario; si insiste antes, contesta 429 con cuántos segundos
  // le faltan). El auto-refresh de 60s va por el cache normal.
  const url = `${VIP.config.API_URL}/api/cashback/status` + (manual ? '?fresh=1' : '');
  fetch(url, {
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
  }).then(function(r) { return r.json().then(function(j) { return { ok: r.ok, j: j }; }); })
    .then(function(res) {
      VIP.ui._rwPollBusy = false;
      if (!res.ok) {
        if (manual) VIP.ui.showToast((res.j && res.j.error) || 'Esperá unos segundos y probá de nuevo.', 'error');
        return;
      }
      const d = res.j;
      if (!d) return;
      if (!VIP.ui._rwSummary) VIP.ui._rwSummary = {};
      const changed = JSON.stringify(d) !== JSON.stringify(VIP.ui._rwSummary.cashback || null);
      VIP.ui._rwSummary.cashback = d;
      VIP.ui._rwCbAt = Date.now();
      // Re-pintar SOLO si cambió algo (#261): re-armar el hub en medio de un
      // deslizamiento cortaba el scroll. El sello "hace Xs" se actualiza en el
      // próximo cambio real o al reabrir — preferible a un hub que salta.
      const ov = document.getElementById('rwHubOverlay');
      if (ov && (changed || manual)) {
        const st = ov.scrollTop;
        VIP.ui.openRewardsHub();
        const ov2 = document.getElementById('rwHubOverlay');
        if (ov2) ov2.scrollTop = st;
      }
      if (manual) VIP.ui.showToast('Actualizado ✔', 'success');
    })
    .catch(function() { VIP.ui._rwPollBusy = false; });
};

// Girar la de BIENVENIDA desde el hub (cierra el hub, abre la rueda; al cerrar vuelve).
VIP.ui._rwSpinWelcome = function() {
  VIP.ui.closeRewardsHub(true);
  VIP.ui._rwReturn = true;
  VIP.ui.casinoBotGo('roulette');
};

// ---- RULETA DIARIA: overlay propio (misma rueda, endpoint /api/roulette) ----
VIP.ui._rwSpinDaily = function() {
  VIP.ui.closeRewardsHub(true);
  VIP.ui._rwReturn = true;
  const d = (VIP.ui._rwSummary && VIP.ui._rwSummary.daily) || {};
  VIP.ui._drSegments = (d.segments || []).map(function(x) { return x.label; });
  VIP.ui._renderDailyRoulette();
};
VIP.ui._renderDailyRoulette = function() {
  VIP.ui.casinoRouletteClose(true);
  const segs = VIP.ui._drSegments || [];
  const n = Math.max(1, segs.length);
  const S = VIP.ui._wheelSize();
  const fs = S >= 320 ? (n > 5 ? 13 : 16) : 12;
  const ov = document.createElement('div');
  ov.id = 'wrOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.9);display:flex;flex-direction:column;' +
    // justify-content:center RECORTABA la parte de arriba en pantallas cortas
    // (bug de flex+overflow) → top-aligned con padding; scroll táctil iOS (#261).
    'align-items:center;padding:calc(26px + env(safe-area-inset-top,0px)) 16px calc(26px + env(safe-area-inset-bottom,0px));' +
    'box-sizing:border-box;font-family:inherit;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;';
  ov.innerHTML =
    '<button type="button" onclick="VIP.ui.casinoRouletteClose()" aria-label="Cerrar" ' +
      'style="position:absolute;top:12px;right:12px;width:38px;height:38px;border-radius:50%;border:none;background:rgba(255,255,255,.14);' +
      'color:#fff;font-size:20px;font-weight:900;cursor:pointer;">✕</button>' +
    '<div style="color:#26e07f;font-size:22px;font-weight:900;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.6);">🎰 RULETA DIARIA</div>' +
    '<div style="color:#fff;opacity:.85;font-size:14px;margin:4px 0 16px;text-align:center;">Un giro gratis por día. Los % extra valen 24 h. ¡Suerte!</div>' +
    VIP.ui._wheelMarkup({ S: S, segs: segs, fs: fs, accent: '#26e07f', accent2: '#0f9d58',
      palette: ['#0b3d2a', '#1a1a4a', '#0e6b4a', '#2b0a3d', '#0b3d5a', '#3a2c00'] }) +
    '<div id="wrResult" style="color:#fff;text-align:center;font-size:15px;line-height:1.35;max-width:360px;"></div>' +
    '<div id="wrActions" style="width:100%;max-width:360px;display:flex;flex-direction:column;gap:10px;margin-top:6px;">' +
      '<button type="button" id="wrSpinBtn" onclick="VIP.ui.casinoDailySpin()" ' +
        'style="width:100%;background:#26e07f;color:#00301a;border:none;border-radius:16px;padding:16px;' +
        'font-size:19px;font-weight:900;cursor:pointer;box-shadow:0 6px 18px rgba(38,224,127,.35);">🎰 GIRAR</button>' +
    '</div>';
  document.body.appendChild(ov);
  VIP.ui._wrOverlayOpen = true;
};
VIP.ui.casinoDailySpin = function() {
  const btn = document.getElementById('wrSpinBtn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Girando…'; }
  fetch(`${VIP.config.API_URL}/api/roulette/spin`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
    .then(function(res) {
      if (!res.ok || !res.d || !res.d.success) {
        if (btn) { btn.disabled = false; btn.textContent = '🎰 GIRAR'; }
        VIP.ui.showToast((res.d && res.d.error) || 'No se pudo girar. Probá de nuevo.', 'error');
        return;
      }
      const n = Math.max(1, (VIP.ui._drSegments || []).length);
      const idx = Math.max(0, Math.min(n - 1, res.d.prizeIndex || 0));
      const wheel = document.getElementById('wrWheel');
      const segMid = (360 / n) * idx + (360 / n) / 2;
      const target = 360 * 5 + (360 - segMid);
      if (wheel) wheel.style.transform = 'rotate(' + target + 'deg)';
      setTimeout(function() {
        const p = res.d.prize || {};
        VIP.ui._playChime();
        let titulo, detalle;
        if (p.type === 'cash' && p.prizeARS > 0) {
          titulo = '🎉 ¡Ganaste ' + _wrEsc(p.prizeLabel) + '!';
          detalle = '💰 Ya está <b>ACREDITADO</b> en tu saldo.' + (p.rolloverX > 0 ? '<br><span style="font-size:12px;opacity:.8;">Para retirarlo, apostá ' + p.rolloverX + ' veces el premio.</span>' : '');
        } else if (p.type === 'percent') {
          titulo = '🎉 ¡Ganaste ' + _wrEsc(p.prizeLabel) + '!';
          detalle = 'Se suma automático en tu <b>PRÓXIMA CARGA</b>. 💪<br><span style="font-size:12.5px;color:#ffd700;">⏳ Reclamable por <b>24 horas</b>: cargá antes de que venza.</span>';
        } else {
          titulo = '😅 Hoy no hubo suerte';
          detalle = '⏰ Tu próximo giro gratis es en <b>24 horas</b>. ¡Volvé a intentar!';
        }
        const rEl = document.getElementById('wrResult');
        if (rEl) {
          rEl.innerHTML = '<div style="font-size:26px;font-weight:900;color:#26e07f;margin:4px 0 8px;text-shadow:0 2px 6px rgba(0,0,0,.6);">' + titulo + '</div><div>' + detalle + '</div>';
        }
        const aEl = document.getElementById('wrActions');
        if (aEl) {
          aEl.innerHTML =
            (p.type === 'percent'
              ? '<button type="button" onclick="VIP.ui.casinoRouletteClose(true);VIP.ui._rwReturn=false;VIP.ui.casinoBotGo(\'deposit\')" style="width:100%;background:#26e07f;color:#00301a;border:none;border-radius:16px;padding:15px;font-size:17px;font-weight:900;cursor:pointer;">💳 Cargar ahora y usarlo</button>'
              : '') +
            '<button type="button" onclick="VIP.ui.casinoRouletteClose()" style="width:100%;background:rgba(255,255,255,.14);color:#fff;border:none;border-radius:16px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">Cerrar</button>';
        }
        try { VIP.ui._refreshRewards(); } catch (e) {}
        if (p.type === 'cash' && p.prizeARS > 0 && VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) {} }
      }, 4400);
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '🎰 GIRAR'; }
      VIP.ui.showToast('Error de conexión. Probá de nuevo.', 'error');
    });
};

// ---- GUÍA DE INSTALACIÓN de la app (#256c) — overlay PROPIO por encima del
// hub y del casino, con pasos según plataforma y checks en vivo (✅/❌) de
// "app instalada" y "notificaciones aceptadas". Si no puede: deriva a soporte
// mandando el mensaje solo (texto del cliente → el chat pasa a Abiertos). ----
VIP.ui._rwShowInstallGuide = function() {
  VIP.ui._rwCloseInstallGuide();
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  let notifOk = false;
  try { notifOk = typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch (e) {}
  const chk = function(ok, label) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:11px;margin-bottom:6px;' +
      'background:' + (ok ? 'rgba(38,224,127,0.12)' : 'rgba(229,57,53,0.10)') + ';border:1px solid ' + (ok ? '#26e07f66' : '#e5393566') + ';">' +
      '<span style="font-size:17px;">' + (ok ? '✅' : '❌') + '</span>' +
      '<span style="font-size:13px;color:#fff;font-weight:700;">' + label + '</span>' +
      '<span style="margin-left:auto;font-size:11px;color:' + (ok ? '#26e07f' : '#ff8a80') + ';font-weight:800;">' + (ok ? 'LISTO' : 'FALTA') + '</span></div>';
  };
  const step = function(n, html) {
    return '<div style="display:flex;gap:10px;margin-bottom:9px;align-items:flex-start;">' +
      '<span style="flex:none;width:22px;height:22px;border-radius:50%;background:#26e07f;color:#00301a;font-size:12px;font-weight:900;' +
      'display:flex;align-items:center;justify-content:center;">' + n + '</span>' +
      '<span style="font-size:13px;color:#cfd6de;line-height:1.45;">' + html + '</span></div>';
  };
  let steps;
  if (isIOS) {
    steps =
      step(1, 'Abrí esta página en <b>Safari</b> y tocá el botón <b>Compartir</b> (el cuadradito con la flecha ⬆️, abajo al medio).') +
      step(2, 'Bajá en la lista y tocá <b>"Agregar a inicio"</b> (Add to Home Screen) → <b>Agregar</b>.') +
      step(3, 'Cerrá Safari y abrí la app desde el <b>ícono nuevo</b> en tu pantalla de inicio.') +
      step(4, 'La app te va a pedir iniciar sesión: <b>entrá con tus datos de acá abajo</b> 👇') +
      step(5, 'Dentro de la app, tocá el botón <b>🔔 ACTIVAR NOTIFICACIONES</b> de abajo y elegí <b>"Permitir"</b>.');
  } else {
    steps =
      step(1, 'Tocá el <b>menú ⋮</b> de Chrome (arriba a la derecha).') +
      step(2, 'Tocá <b>"Instalar app"</b> o <b>"Agregar a la pantalla principal"</b> → <b>Instalar</b>.') +
      step(3, 'Abrí la app desde el <b>ícono nuevo</b> en tu pantalla de inicio.') +
      step(4, 'Si te pide iniciar sesión, <b>entrá con tus datos de acá abajo</b> 👇') +
      step(5, 'Tocá el botón <b>🔔 ACTIVAR NOTIFICACIONES</b> de abajo y elegí <b>"Permitir"</b>.');
  }
  // 🪪 Datos de ingreso DENTRO de la guía (#256e): al abrir la app instalada
  // suele pedir login (sobre todo iPhone) → usuario + clave a mano, con copiar.
  const _gUser = (VIP.state.currentUser && VIP.state.currentUser.username) || '';
  const _gPass = VIP.state.sessionPassword || VIP.ui._credsDefaultPass || null;
  let credsBox = '';
  if (_gUser) {
    credsBox = '<div style="background:linear-gradient(160deg,rgba(255,215,0,0.10),rgba(255,215,0,0.03));border:1px solid #ffd70055;' +
      'border-radius:16px;padding:13px 14px;margin:0 0 12px;">' +
      '<div style="font-size:13px;font-weight:900;color:#ffd700;margin-bottom:7px;">🪪 TUS DATOS PARA ENTRAR EN LA APP</div>' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">' +
        '<span style="font-size:12px;color:#9aa4b0;">👤 Usuario:</span>' +
        '<b style="font-size:15px;color:#fff;">' + _wrEsc(_gUser) + '</b>' +
        '<button type="button" onclick="VIP.ui._copyCred(\'' + _wrEsc(_gUser) + '\')" style="background:rgba(255,255,255,0.12);border:none;color:#fff;' +
        'border-radius:7px;padding:3px 9px;font-size:11px;font-weight:800;cursor:pointer;">📋 copiar</button></div>' +
      (_gPass
        ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span style="font-size:12px;color:#9aa4b0;">🔑 Clave:</span>' +
            '<b style="font-size:15px;color:#fff;">' + _wrEsc(_gPass) + '</b>' +
            '<button type="button" onclick="VIP.ui._copyCred(\'' + _wrEsc(_gPass) + '\')" style="background:rgba(255,255,255,0.12);border:none;color:#fff;' +
            'border-radius:7px;padding:3px 9px;font-size:11px;font-weight:800;cursor:pointer;">📋 copiar</button></div>' +
          '<div style="font-size:10.5px;color:#9aa4b0;margin-top:6px;">Anotalos o sacá captura antes de instalar. 📸</div>'
        : '<div style="font-size:12px;color:#cfd6de;">🔑 Clave: la que elegiste al crear tu cuenta. ¿La olvidaste? Tocá Soporte y te la cambiamos.</div>') +
    '</div>';
    // Si la clave default todavía no se consultó, pedirla y re-pintar la guía.
    if (!_gPass && !VIP.ui._credsFetched) {
      VIP.ui._credsFetched = true;
      fetch(`${VIP.config.API_URL}/api/users/my-credentials`, {
        headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
      }).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
        if (d && d.defaultPassword) {
          VIP.ui._credsDefaultPass = d.defaultPassword;
          if (document.getElementById('rwInstallOverlay')) VIP.ui._rwShowInstallGuide();
        }
      }).catch(function() {});
    }
  }
  const nativeBtn = (!isIOS && window.deferredPrompt)
    ? '<button type="button" onclick="VIP.ui._rwNativeInstall()" style="width:100%;margin-bottom:8px;border:none;cursor:pointer;' +
      'background:linear-gradient(135deg,#26e07f,#0f9d58);color:#00301a;border-radius:13px;padding:14px;font-size:16px;font-weight:900;">📲 INSTALAR AHORA (1 toque)</button>'
    : '';
  // 🔔 CAMPANA (#272, owner: "que la gente no tenga que ir a ajustes"): un
  // toque dispara el cartel nativo Permitir / No permitir. Tres estados:
  //  - default  → botón grande; requestPermission() se llama DENTRO del gesto.
  //  - denied   → el navegador ya no vuelve a preguntar: el botón despliega
  //               cómo desbloquearlo (es el único caso que requiere ajustes).
  //  - iOS sin app instalada → Safari no da push: se avisa que primero instale.
  let permState = 'default';
  try { permState = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'; } catch (e) {}
  let bellBtn = '';
  if (!notifOk) {
    if (isIOS && !installed) {
      bellBtn = '<div style="font-size:12px;color:#ffd700;background:rgba(255,215,0,0.08);border:1px solid #ffd70044;border-radius:11px;' +
        'padding:9px 12px;margin-bottom:8px;">🔔 En iPhone las notificaciones se activan <b>desde la app instalada</b> (pasos 1-3). Ahí vas a ver este botón.</div>';
    } else if (permState === 'denied') {
      bellBtn = '<button type="button" onclick="VIP.ui._rwToggleNotifHelp()" style="width:100%;margin-bottom:8px;border:none;cursor:pointer;' +
        'background:linear-gradient(135deg,#ff8a80,#e53935);color:#fff;border-radius:13px;padding:14px;font-size:15px;font-weight:900;">🔔 Notificaciones BLOQUEADAS — cómo activarlas</button>' +
        '<div id="rwNotifHelp" style="display:none;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);border-radius:13px;padding:12px 14px;margin-bottom:8px;font-size:12.5px;color:#cfd6de;line-height:1.5;">' +
        (isIOS
          ? '<b style="color:#fff;">iPhone:</b> Ajustes del teléfono → <b>Notificaciones</b> → buscá la app en la lista → <b>Permitir notificaciones</b>. Después volvé acá y tocá "Ya lo hice".'
          : '<b style="color:#fff;">Android:</b><br>• Si estás en <b>Chrome</b>: tocá el <b>candado 🔒</b> (o ⓘ) al lado de la dirección → <b>Permisos</b> → <b>Notificaciones</b> → Permitir.<br>' +
            '• Si estás en la <b>app instalada</b>: mantené apretado el ícono de la app → <b>Información de la app</b> → <b>Notificaciones</b> → activar.<br>Después volvé acá y tocá "Ya lo hice".') +
        '</div>';
    } else if (permState === 'unsupported') {
      bellBtn = '<div style="font-size:12px;color:#ff8a80;margin-bottom:8px;">⚠️ Este navegador no soporta notificaciones. Usá Chrome (Android) o la app instalada (iPhone).</div>';
    } else {
      bellBtn = '<button type="button" id="rwBellBtn" onclick="VIP.ui._rwEnableNotifs(this)" style="width:100%;margin-bottom:8px;border:none;cursor:pointer;' +
        'background:linear-gradient(135deg,#53bdeb,#1e96d6);color:#fff;border-radius:13px;padding:14px;font-size:16px;font-weight:900;' +
        'box-shadow:0 0 14px rgba(42,171,238,0.45);">🔔 ACTIVAR NOTIFICACIONES (1 toque)</button>' +
        '<div style="font-size:11px;color:#9aa4b0;margin:-2px 0 10px;text-align:center;">Te va a aparecer un cartel: tocá <b style="color:#fff;">Permitir</b>.</div>';
    }
  }
  const ov = document.createElement('div');
  ov.id = 'rwInstallOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483100;display:flex;flex-direction:column;align-items:center;' +
    'background:radial-gradient(120% 90% at 50% 0%,#12241a 0%,#0a120d 55%,#070a08 100%);' +
    'overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;' +
    'padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px));box-sizing:border-box;';
  ov.innerHTML =
    '<button type="button" onclick="VIP.ui._rwCloseInstallGuide(true)" aria-label="Volver" ' +
      'style="position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:12px;width:38px;height:38px;border-radius:50%;' +
      'border:none;background:rgba(255,255,255,.12);color:#fff;font-size:19px;font-weight:900;cursor:pointer;">✕</button>' +
    '<div style="width:100%;max-width:420px;">' +
      '<div style="text-align:center;margin:6px 0 14px;">' +
        '<div style="font-size:32px;line-height:1;">📲</div>' +
        '<div style="font-size:20px;font-weight:900;color:#fff;margin-top:4px;">Instalá la app' + (isIOS ? ' (iPhone)' : ' (Android)') + '</div>' +
        '<div style="font-size:12px;color:#9aa4b0;margin-top:2px;">Con la app instalada girás la ruleta GRATIS todos los días</div>' +
      '</div>' +
      chk(installed, 'App instalada') +
      chk(notifOk, 'Notificaciones aceptadas') +
      (installed ? '' : '<div style="font-size:11px;color:#9aa4b0;margin:2px 0 10px;">Si ya la instalaste, abrí esta pantalla DESDE la app (el ícono nuevo) para que quede en verde.</div>') +
      '<div style="background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:14px 14px 6px;margin:8px 0 12px;">' + steps + '</div>' +
      credsBox +
      nativeBtn +
      bellBtn +
      '<button type="button" onclick="VIP.ui._rwShowInstallGuide()" style="width:100%;margin-bottom:8px;border:none;cursor:pointer;' +
        'background:linear-gradient(135deg,#ffd700,#ff9800);color:#231a00;border-radius:13px;padding:13px;font-size:15px;font-weight:900;">🔄 Ya lo hice — verificar</button>' +
      '<button type="button" onclick="VIP.ui._rwSupportCantInstall()" style="width:100%;border:none;cursor:pointer;' +
        'background:rgba(255,255,255,0.10);color:#fff;border-radius:13px;padding:13px;font-size:14px;font-weight:800;">🎧 No puedo — hablar con soporte</button>' +
    '</div>';
  document.body.appendChild(ov);
  if (installed && notifOk) {
    try { VIP.ui.showToast('✅ ¡Listo! App instalada y notificaciones activas.', 'success'); } catch (e) {}
    try { VIP.ui._refreshRewards(); } catch (e) {}
  }
};
VIP.ui._rwCloseInstallGuide = function(backToHub) {
  const ov = document.getElementById('rwInstallOverlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  if (backToHub) { try { VIP.ui.openRewardsHub(); } catch (e) {} }
};
// Campana: pide el permiso DENTRO del gesto (iOS lo exige y Chrome pierde la
// "activación" si antes esperamos a Firebase), y recién después delega en
// window.enableNotifications() (inline de index.html: token FCM + registro en
// el backend + toasts). Al final re-pinta la guía para que el check quede ✅.
VIP.ui._rwEnableNotifs = async function(btn) {
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Tocá "Permitir" en el cartel…'; }
    let perm = 'default';
    try { perm = Notification.permission; } catch (e) {}
    if (perm === 'default') {
      try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
    }
    if (perm === 'granted') {
      if (btn) btn.textContent = '⏳ Activando…';
      try { if (typeof window.enableNotifications === 'function') await window.enableNotifications(); } catch (e) {}
    } else if (perm === 'denied') {
      try { VIP.ui.showToast('Tocaste "No permitir". Abajo te mostramos cómo activarlas.', 'warning'); } catch (e) {}
    }
  } catch (e) {}
  // Re-render: muestra ✅ o, si quedó bloqueado, el botón rojo con la ayuda.
  VIP.ui._rwShowInstallGuide();
  try { if (Notification.permission === 'denied') VIP.ui._rwToggleNotifHelp(true); } catch (e) {}
};
VIP.ui._rwToggleNotifHelp = function(force) {
  const h = document.getElementById('rwNotifHelp');
  if (!h) return;
  h.style.display = (force === true || h.style.display === 'none') ? 'block' : 'none';
};
VIP.ui._rwNativeInstall = async function() {
  try {
    if (!window.deferredPrompt) { VIP.ui._rwShowInstallGuide(); return; }
    window.deferredPrompt.prompt();
    const r = await window.deferredPrompt.userChoice;
    window.deferredPrompt = null;
    if (r && r.outcome === 'accepted') VIP.ui.showToast('✅ Instalando… abrila desde el ícono nuevo', 'success');
    VIP.ui._rwShowInstallGuide(); // re-chequear estados
  } catch (e) {}
};
// "No puedo": cierra los overlays, abre SOPORTE y manda el mensaje SOLO —
// al ser un texto del cliente, el chat pasa a Abiertos y lo agarra un agente.
VIP.ui._rwSupportCantInstall = function() {
  VIP.ui._rwCloseInstallGuide();
  VIP.ui.closeRewardsHub(true);
  try { if (!VIP.ui._casinoChatPh && VIP.ui.openCasinoChat) VIP.ui.openCasinoChat(); } catch (e) {}
  try { VIP.ui.casinoBotSupport(); } catch (e) {}
  const content = '📲 Hola! No puedo instalar la app / activar las notificaciones para la ruleta diaria. ¿Me ayudan?';
  const sendHttp = function() {
    fetch(`${VIP.config.API_URL}/api/messages/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content, type: 'text' })
    }).catch(function() {});
  };
  setTimeout(function() {
    try {
      if (VIP.state.socket && VIP.state.socket.connected && VIP.state.socketAuthed) {
        VIP.state.socket.emit('send_message', { content: content, type: 'text' });
      } else { sendHttp(); }
    } catch (e) { sendHttp(); }
  }, 600);
};

// ---- CASHBACK: reclamo desde el hub ----
VIP.ui.casinoCashbackClaim = function() {
  const d = (VIP.ui._rwSummary && VIP.ui._rwSummary.cashback) || {};
  if (!confirm('¿Reclamar tu reembolso de ' + _rwFmt(d.reclamable) + '?\nEntra YA a tu saldo para seguir jugando.' + (d.rolloverX > 0 ? ' Para retirarlo, apostalo x' + d.rolloverX + ' en slots o ruleta.' : ''))) return;
  fetch(`${VIP.config.API_URL}/api/cashback/claim`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(function(r) { return r.json().then(function(j) { return { ok: r.ok, j: j }; }); })
    .then(function(res) {
      if (!res.ok || !res.j || !res.j.success) {
        VIP.ui.showToast((res.j && res.j.error) || 'No se pudo reclamar. Probá de nuevo.', 'error');
        VIP.ui._refreshRewards();
        return;
      }
      VIP.ui._playChime();
      VIP.ui.showToast('💸 ¡Reembolso de ' + _rwFmt(res.j.amount) + ' acreditado en tu saldo! A jugar 🎰', 'success');
      if (VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) {} }
      VIP.ui._refreshRewards();
    })
    .catch(function() { VIP.ui.showToast('Error de conexión. Probá de nuevo.', 'error'); });
};

function _wrEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/** Pide el spin al server, anima la rueda hasta el segmento premiado y muestra
 *  el resultado. El premio SIEMPRE lo decide el server (prizeIndex). */
VIP.ui.casinoRouletteSpin = function() {
  const btn = document.getElementById('wrSpinBtn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Girando…'; }
  fetch(`${VIP.config.API_URL}/api/welcome-roulette/spin`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
    .then(function(res) {
      if (!res.ok || !res.d || !res.d.success) {
        if (btn) { btn.disabled = false; btn.textContent = '🎡 GIRAR'; }
        VIP.ui.showToast((res.d && res.d.error) || 'No se pudo girar. Probá de nuevo.', 'error');
        return;
      }
      const n = Math.max(1, (VIP.ui._wrSegments || []).length);
      const idx = Math.max(0, Math.min(n - 1, res.d.prizeIndex || 0));
      const wheel = document.getElementById('wrWheel');
      // Rotar para que el CENTRO del segmento premiado quede bajo el puntero
      // (arriba). +5 vueltas para el efecto. El puntero está arriba (0deg).
      const segMid = (360 / n) * idx + (360 / n) / 2;
      const target = 360 * 5 + (360 - segMid);
      if (wheel) wheel.style.transform = 'rotate(' + target + 'deg)';
      setTimeout(function() {
        const p = res.d.prize || {};
        VIP.ui._playChime();
        // Guardar el resultado para "Mi premio" (se puede volver a ver siempre).
        VIP.ui._wrStatus = { enabled: true, canSpin: false, alreadySpun: true, prize: {
          label: p.label, type: p.type, value: p.value, rolloverX: p.rolloverX || 0,
          status: p.type === 'cash' ? 'credited' : 'pending', spunAt: new Date().toISOString(), usedAt: null
        } };
        const isCash = p.type === 'cash' && p.credited;
        const detalle = isCash
          ? '💰 Ya está <b>ACREDITADO</b> en tu saldo. ¡A jugar! 🎰' +
            (p.rolloverX > 0 ? '<br><span style="font-size:12px;opacity:.8;">Para retirarlo, apostá ' + p.rolloverX + ' veces el premio.</span>' : '')
          : 'Se te aplica en tu <b>PRÓXIMA CARGA</b> — cargá y lo sumamos automáticamente. 💪' + _wrBonusRuleTxt(p.value);
        // Resultado en el overlay (pantalla completa).
        const rEl = document.getElementById('wrResult');
        if (rEl) {
          rEl.innerHTML = '<div style="font-size:14px;opacity:.85;">🎉 ¡Ganaste!</div>' +
            '<div style="font-size:30px;font-weight:900;color:#ffd700;margin:4px 0 8px;text-shadow:0 2px 6px rgba(0,0,0,.6);">' + _wrEsc(p.label) + '</div>' +
            '<div>' + detalle + '</div>' +
            '<div style="font-size:12px;opacity:.75;margin-top:10px;">📸 Sacá captura si querés. Lo podés volver a ver desde <b>🎡 Mi premio</b> en el asistente.</div>';
        }
        const aEl = document.getElementById('wrActions');
        if (aEl) {
          aEl.innerHTML =
            '<button type="button" onclick="VIP.ui.casinoRouletteClose(true);VIP.ui.casinoBotGo(\'deposit\')" ' +
              'style="width:100%;background:#ffd700;color:#3a2c00;border:none;border-radius:16px;padding:15px;font-size:18px;font-weight:900;cursor:pointer;">💳 Cargar ahora</button>' +
            '<button type="button" onclick="VIP.ui.casinoRouletteClose()" ' +
              'style="width:100%;background:rgba(255,255,255,.14);color:#fff;border:none;border-radius:16px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">Cerrar</button>';
        }
        // Copia en el hilo del asistente (queda en el historial del widget).
        VIP.ui._botMsg('🎉 <b>¡Ganaste ' + _wrEsc(p.label) + '!</b><br>' + detalle);
        try { VIP.ui._refreshRewards(); } catch (e) {}
      }, 4400);
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '🎡 GIRAR'; }
      VIP.ui.showToast('Error de conexión. Probá de nuevo.', 'error');
    });
};

/** Toggle claro/oscuro del widget = el MISMO modo del chat de soporte
 *  (body.wa-dark, persistido en localStorage 'waDark' como el switch de
 *  Configuración) — así asistente y soporte siempre coinciden. */
VIP.ui.casinoToggleTheme = function() {
  const dark = !document.body.classList.contains('wa-dark');
  document.body.classList.toggle('wa-dark', dark);
  try { localStorage.setItem('waDark', dark ? '1' : '0'); } catch (e) {}
  // Sincronizar el switch del modal de Configuración (si está en el DOM).
  const chk = document.getElementById('waDarkToggle');
  if (chk) chk.checked = dark;
  VIP.ui._syncCasinoThemeBtn();
};

/** El ícono del header muestra a qué modo se CAMBIA (como el 🌙/☀️ del chat). */
VIP.ui._syncCasinoThemeBtn = function() {
  const b = document.getElementById('casinoThemeBtn');
  if (b) b.textContent = document.body.classList.contains('wa-dark') ? '☀️' : '🌙';
};

/** Sonido de notificación (WebAudio, sin archivo — dos tonos ascendentes). */
VIP.ui._playChime = function() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Reusar el contexto que notifications.js desbloquea con el primer gesto
    // (#273): un contexto propio creado fuera de un gesto suena mudo en mobile.
    if (!VIP.ui._audioCtx) VIP.ui._audioCtx = (VIP.state && VIP.state.notificationAudioContext) || new AC();
    const ctx = VIP.ui._audioCtx;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    [ [880, 0], [1320, 0.14] ].forEach(function(p) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = p[0];
      const t = ctx.currentTime + p[1];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.36);
    });
  } catch (e) {}
};

/** La carga ACREDITÓ (balance_updated con saldo en alza): CARTEL GRANDE
 *  centrado + sonido para que el cliente se dé cuenta (owner 2026-08-21),
 *  y confirmación en el asistente. Sirve para carga automática Y manual del
 *  admin (ambas emiten balance_updated). */
VIP.ui.casinoBotDepositConfirmed = function(newBalance, info) {
  // Cortar la cuenta regresiva del comprobante: la carga LLEGÓ.
  clearInterval(VIP.ui._botCdTimer);
  VIP.ui._botCdTimer = null;
  if (VIP.ui._botCdNode) { VIP.ui._botCdNode.style.display = 'none'; VIP.ui._botCdNode = null; }

  // CARTEL GRANDE sobre el casino + sonido.
  VIP.ui._playChime();
  let ov = document.getElementById('casinoDepositToast');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'casinoDepositToast';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100002;display:none;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,0.6);';
    document.body.appendChild(ov);
  }
  const amt = (Number(newBalance) || 0).toLocaleString('es-AR');
  // #282: si la carga incluyó BONO, el cartel dice cuánto y con qué ROLLOVER
  // (el global del panel; viene en el evento balance_updated).
  let bonusHtml = '';
  const bAmt = info && Number(info.bonusAmount) > 0 ? Number(info.bonusAmount) : 0;
  if (bAmt > 0) {
    const rx = info && info.rolloverX != null ? Number(info.rolloverX) : null;
    const rollTxt = rx == null ? '' : (rx > 0
      ? '🎯 ROLLOVER x' + rx + ': apostá ' + rx + ' veces el bono para poder retirarlo'
      : '✅ Sin rollover: podés retirarlo cuando quieras');
    bonusHtml =
      '<div style="background:rgba(255,215,0,0.12);border:1px solid #ffd70066;border-radius:12px;padding:9px 10px;margin:0 0 14px;">' +
        '<div style="color:#ffd700;font-weight:900;font-size:14px;">🎁 Incluye $' + bAmt.toLocaleString('es-AR') + ' de bono</div>' +
        (rollTxt ? '<div style="color:#ffe9a6;font-size:12px;margin-top:3px;">' + rollTxt + '</div>' : '') +
      '</div>';
  }
  // #331 (owner 2026-10-07): empujón para INSTALAR LA APP justo después de la
  // carga (momento de más entusiasmo). Solo si no la tiene instalada. La ruleta
  // diaria y los reembolsos exigen la app (#301): ese es el gancho.
  const _installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const installHtml = _installed ? '' :
    '<div style="background:linear-gradient(135deg,rgba(255,215,0,0.16),rgba(124,58,237,0.22));border:1.5px solid #ffd700;border-radius:14px;' +
      'padding:11px 10px;margin:0 0 12px;box-shadow:0 0 18px rgba(255,215,0,0.25);">' +
      '<div style="color:#ffd700;font-weight:900;font-size:15px;letter-spacing:0.3px;">📲 ¡INSTALÁ LA APP Y RECLAMÁ TUS PREMIOS!</div>' +
      '<div style="color:#fff;font-size:12.5px;line-height:1.45;margin:5px 0 8px;">' +
        'Con la app instalada reclamás tu <b style="color:#26e07f;">🎰 RULETA DIARIA de hoy</b> y tus ' +
        '<b style="color:#4dd0ff;">💸 REEMBOLSOS diario, semanal y mensual</b> de tu NETWIN.</div>' +
      '<button type="button" onclick="VIP.ui._hideCasinoDepositToast();VIP.ui._rwShowInstallGuide()" ' +
        'style="width:100%;background:#ffd700;color:#2a1a00;border:none;border-radius:12px;padding:11px;' +
        'font-size:14px;font-weight:900;cursor:pointer;">📲 INSTALAR LA APP AHORA</button>' +
    '</div>';
  ov.innerHTML =
    '<div style="width:min(90vw,360px);background:linear-gradient(155deg,#0d3b23,#0a2e1b);' +
    'border:2px solid #25d366;border-radius:22px;padding:26px 22px;text-align:center;' +
    'box-shadow:0 18px 60px rgba(37,211,102,0.45);">' +
      '<div style="font-size:52px;line-height:1;">✅</div>' +
      '<div style="color:#25d366;font-weight:900;font-size:24px;margin:8px 0 2px;">¡Carga acreditada!</div>' +
      '<div style="color:#cfe9d8;font-size:14px;">Tu saldo ahora es</div>' +
      '<div style="color:#fff;font-weight:900;font-size:34px;margin:4px 0 ' + (bonusHtml || installHtml ? '10px' : '16px') + ';">$' + amt + '</div>' +
      bonusHtml +
      installHtml +
      '<button type="button" onclick="VIP.ui._hideCasinoDepositToast()" ' +
        'style="width:100%;background:#25d366;color:#04310f;border:none;border-radius:14px;padding:14px;' +
        'font-size:16px;font-weight:900;cursor:pointer;">🎰 ¡A JUGAR!</button>' +
    '</div>';
  ov.style.display = 'flex';
  clearTimeout(VIP.ui._depositToastTimer);
  // Con el empujón de la app el cartel dura más (hay más para leer).
  VIP.ui._depositToastTimer = setTimeout(VIP.ui._hideCasinoDepositToast, installHtml ? 14000 : 8000);

  // Confirmación también en el hilo del asistente (si no está en soporte).
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer && (drawer.style.display === 'none' || !drawer.style.display)) VIP.ui.openCasinoChat();
  if (VIP.ui._casinoChatPh) return; // en modo soporte no se pisa el chat real
  VIP.ui._botStarted = true;
  VIP.ui._botMsg('💰 <b>¡Carga acreditada!</b> Tu saldo ahora es <b>$' + amt + '</b> 🎰' +
    (bAmt > 0 ? '<br>🎁 Incluye $' + bAmt.toLocaleString('es-AR') + ' de bono' +
      (info && info.rolloverX > 0 ? ' · 🎯 ROLLOVER x' + Number(info.rolloverX) : (info && info.rolloverX === 0 ? ' · sin rollover' : '')) : ''));
  // #331: el mismo empujón queda en el hilo (el cartel se va solo; esto no).
  if (installHtml) {
    VIP.ui._botMsg('📲 <b style="color:#ffd700;">¡INSTALÁ LA APP Y RECLAMÁ TUS PREMIOS!</b><br>' +
      'Con la app instalada reclamás tu <b>🎰 RULETA DIARIA de hoy</b> y tus <b>💸 REEMBOLSOS diario, semanal y mensual</b> de tu NETWIN. ' +
      'Es un toque y queda en tu pantalla de inicio.');
    VIP.ui._botRow(VIP.ui._botBtn('📲 Instalar la app ahora', 'VIP.ui._rwShowInstallGuide()', true));
  }
};

VIP.ui._hideCasinoDepositToast = function() {
  clearTimeout(VIP.ui._depositToastTimer);
  const ov = document.getElementById('casinoDepositToast');
  if (ov) ov.style.display = 'none';
};

/** Cierra el recuadro y vuelve a VIPCARGAS. */
VIP.ui.closeCasinoFrame = function() {
  clearTimeout(VIP.ui._casinoWatchdog);
  clearTimeout(VIP.ui._casinoEscapeTimer);
  VIP.ui._hideCasinoEscapeBar();
  // Si el chat estaba mudado al panel del casino, SIEMPRE devolverlo a la
  // página antes de cerrar (si no, la pantalla principal queda sin chat).
  VIP.ui._casinoChatUnmount();
  const overlay = document.getElementById('casinoOverlay');
  if (!overlay) return;
  // Se vacía el src para que el casino deje de correr en segundo plano (si no, sigue
  // sonando y consumiendo datos aunque el recuadro esté oculto).
  const frame = overlay.querySelector('#casinoFrame');
  if (frame) frame.src = '';
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  VIP.ui._casinoOpen = false;

  // Al volver, refrescar el saldo: es muy probable que haya cambiado jugando.
  if (VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) {} }
};

/** Muestra un error dentro del recuadro, con la opción de reintentar o salir. */
VIP.ui._casinoFrameError = function(msg) {
  const status = document.getElementById('casinoFrameStatus');
  if (!status) {
    VIP.ui.showToast(msg, 'error');
    return;
  }
  status.style.display = 'flex';
  status.style.flexDirection = 'column';
  status.style.gap = '14px';
  status.innerHTML =
    '<div style="color:#ff8080;font-weight:700;max-width:420px;line-height:1.45;">' + msg + '</div>' +
    '<button type="button" onclick="VIP.ui.enterCasino()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '🔄 Reintentar</button>' +
    '<button type="button" onclick="VIP.ui.closeCasinoFrame()" ' +
      'style="background:none;color:#aaa;border:none;font-size:14px;cursor:pointer;">' +
      'Volver a 1GIROX</button>';
};

// El botón "atrás" del celular cierra el recuadro en vez de salir de la app.
window.addEventListener('popstate', function() {
  if (VIP.ui._casinoOpen) VIP.ui.closeCasinoFrame();
});

// Botón "Abrir Casino" DENTRO del modal (que ahora es el camino de respaldo, cuando
// el SSO falló). Abre el casino a secas para que el usuario entre a mano con los
// datos que el modal le muestra.
VIP.ui.goToPlatform = function() {
  window.open(VIP.config.PLATFORM_URL, '_blank');
  VIP.ui.closePlatformModal();
};


VIP.ui.togglePlatformPasswordVisibility = function() {
  const pwdEl = document.getElementById('platformModalPassword');
  const toggle = document.getElementById('platformPasswordToggle');
  if (!pwdEl) return;
  const plain = VIP.state.sessionPassword || '';
  if (!plain) return;
  VIP.ui._platformPasswordVisible = !VIP.ui._platformPasswordVisible;
  if (VIP.ui._platformPasswordVisible) {
    pwdEl.textContent = plain;
    if (toggle) toggle.textContent = '🙈';
  } else {
    pwdEl.textContent = '••••••••';
    if (toggle) toggle.textContent = '👁';
  }
};

VIP.ui.savePlatformPassword = function() {
  const input = document.getElementById('platformPasswordManualInput');
  if (!input || !input.value.trim()) return;
  const pwd = input.value.trim();
  VIP.state.sessionPassword = pwd;
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = '••••••••';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = 'none';
  input.value = '';
  VIP.ui.showToast('✅ Contraseña guardada para esta sesión', 'success');
};

VIP.ui.showPlatformPasswordChange = function() {
  // Cerrar el modal de plataforma
  VIP.ui.closePlatformModal();
  // Asegurarse de que el cambio sea voluntario (no obligatorio)
  VIP.state.passwordChangePending = false;
  // Preparar y abrir el modal de cambio de contraseña
  if (typeof VIP.auth.prepareChangePasswordModal === 'function') {
    VIP.auth.prepareChangePasswordModal();
  } else if (typeof window.prepareChangePasswordModal === 'function') {
    window.prepareChangePasswordModal();
  }
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.classList.remove('hidden');
};
