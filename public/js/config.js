// ========================================
// CONFIG - VIP Namespace & shared state
// ========================================

window.VIP = window.VIP || {};

VIP.config = {
    API_URL: '',
    // Sitio de juego (1girox). Sólo se usa como respaldo, cuando el login único (SSO)
    // falla y el usuario tiene que entrar a mano desde el modal. El camino normal es
    // VIP.ui.enterCasino(), que recibe del backend un link de acceso ya autenticado.
    PLATFORM_URL: 'https://1girox.com',
    FRONTEND_MSG_RATE_MAX: 2,
    FRONTEND_MSG_RATE_WINDOW_MS: 1000,
    CBU_CLICK_COOLDOWN_MS: 10000
};

// Shared mutable application state (all modules read/write through here)
VIP.state = {
    currentToken: localStorage.getItem('userToken'),
    currentUser: null,
    socket: null,
    refundStatus: null,
    refundTimers: {},
    lastMessageId: null,
    messageCheckInterval: null,
    balanceCheckInterval: null,
    processedMessageIds: new Set(),
    pendingSentMessages: new Map(),
    lastSentMessageTimestamp: 0,
    passwordChangePending: false,
    sentMessageTimestamps: [],
    lastCbuClickTime: 0,
    notificationAudioContext: null,
    isLoadingMessages: false,
    lastMessagesHash: '',
    fireStatus: null,
    fireCountdownInterval: null,
    referralData: null,
    sessionPassword: ''
};

// ---- Interruptores del panel: SMS y registro (#322) ----
// El admin general los prende/apaga desde el panel (Configuración → "SMS y
// registro"). Default APAGADO. El inline del <head> ya aplicó lo último que se
// supo; acá se refresca contra el server y se guarda para la próxima carga.
// Regla: lo que dependa del SMS o del registro pregunta VIP.flags.sms /
// VIP.flags.signup (=== true), y el CSS de index.html oculta por las clases
// html.sms-off / html.signup-off.
VIP.flags = Object.assign({ sms: false, signup: false }, window.__vipAccessFlags || {});

VIP.applyAccessFlags = function (flags) {
    VIP.flags = { sms: !!(flags && flags.sms === true), signup: !!(flags && flags.signup === true),
        usernamePrefix: (flags && typeof flags.usernamePrefix === 'string') ? flags.usernamePrefix : 'g1' }; // #328
    const h = document.documentElement;
    h.classList.toggle('sms-off', !VIP.flags.sms);
    h.classList.toggle('signup-off', !VIP.flags.signup);
    try { localStorage.setItem('vip_access_flags', JSON.stringify(VIP.flags)); } catch (e) {}
    try { if (VIP.auth && VIP.auth.refreshVerifyPhoneBanner) VIP.auth.refreshVerifyPhoneBanner(); } catch (e) {}
};

VIP.loadAccessFlags = function (attempt) {
    fetch(`${VIP.config.API_URL}/api/config/access`, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
        .then(function (j) { VIP.applyAccessFlags({ sms: j.smsEnabled === true, signup: j.registrationEnabled === true, usernamePrefix: j.usernamePrefix }); })
        .catch(function () {
            // Red lenta (Tor/3G): un par de reintentos; mientras tanto queda lo cacheado.
            if ((attempt || 0) < 2) setTimeout(function () { VIP.loadAccessFlags((attempt || 0) + 1); }, 4000 * ((attempt || 0) + 1));
        });
};
VIP.loadAccessFlags(0);

// ---- Argentina timezone helpers (used across modules) ----

function getArgentinaDate(date = new Date()) {
    return new Date(date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

function getArgentinaMidnight() {
    const argentinaNow = getArgentinaDate();
    const midnight = new Date(argentinaNow);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime();
}

window.getArgentinaDate = getArgentinaDate;
window.getArgentinaMidnight = getArgentinaMidnight;
