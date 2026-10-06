// ============================================
// FIREBASE CLOUD MESSAGING + CACHE SERVICE WORKER
// SW único para notificaciones push Y caché PWA.
// Versión: 2.3.0
// ============================================
// ROOT CAUSE FIX: antes existían dos SWs (firebase-messaging-sw.js y
// user-sw.js) compitiendo en el mismo scope (/). Eso provocaba que el
// token FCM apuntara a un SW pero las notificaciones llegaran al otro,
// invalidando todos los envíos. Ahora este es el único SW activo.
// ============================================
// PWA WEBAPK FIX: Chrome Android exige que el SW responda (con
// event.respondWith) a la navegación hacia start_url para generar un
// WebAPK real. Si el SW ignora navigation requests (return sin llamar
// respondWith), Chrome no lo considera capaz de controlar start_url y
// sólo ofrece un acceso directo/shortcut en lugar de instalar la app
// como WebAPK. Se usa redirect:'manual' para que las redirecciones de
// Cloudflare Challenge sean seguidas por el navegador de forma nativa
// (opaqueredirect), sin que el SW actúe como proxy cross-origin.
// ============================================

// SDK Firebase self-hosted (mismo origen). Antes se importaba desde gstatic,
// pero en redes flaky ese host puede fallar y romper el SW entero. Sirviendo
// los scripts del propio dominio garantizamos que el SW siempre instale.
// Fallback a gstatic si el archivo local no estuviera disponible.
try {
  importScripts('/lib/firebase/9.1.2/firebase-app-compat.js');
  importScripts('/lib/firebase/9.1.2/firebase-messaging-compat.js');
} catch (localImportErr) {
  console.warn('[FCM-SW] No se pudo importar Firebase SDK local, cayendo a gstatic:', localImportErr && localImportErr.message);
  importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-messaging-compat.js');
}

// ============================================
// CONFIGURACIÓN DE CACHÉ
// ============================================
const CACHE_VERSION = 'v195'; // v195: interruptores SMS/registro del panel — sin SMS ni registro por default (#322). v194: popup de referidos 1 vez cada 24 h (#319). v193: boton 'Mis referidos' en el pie del widget (#318). v192: referidos 2.0 — popup, modal con nivel y tablero en vivo, ?ref= fijo 30 dias, chooser WhatsApp/Telegram (#317). v191: reembolso semanal/mensual muestra lo COBRADO en diarios (no la base) + fix 'vence en ya mismo' de la ruleta diaria. v190: textos de referidos sin 'lo que pierdan' (comision por actividad). v189: elegir la cuenta nueva bloquea la vieja (con aviso de cual usar). v188: link de landing con otra cuenta logueada → pregunta con cual seguir (no pisa la sesion vieja). v187: 'Invita amigos' copia el link y ofrece WhatsApp / otras apps. v186: mensaje de WhatsApp de referidos editable desde COMANDOS. v185: referidos en PREMIOS (tarjeta 'Invita y gana' + info) y banner en el inicio del asistente. v184: ruleta diaria exige carga en los ultimos N dias (texto del hub). v183: % EXTRA de la ruleta diaria vence a las 24 h (avisos en hub y rueda). v182: avisos 'app instalada + notificaciones activas' (2 cosas) en reembolsos y ruleta. v181: reembolsos exigen app instalada (needsApp) + boton Instalar App vuelve cada 24h. v180: widget redimensionable (agarre arriba) + Depositar de nuevo vuelve a elegir modo. v179: pestana activa en la barra del widget + Depositar como pestana propia. v178: hub PREMIOS muestra reembolsos diario/semanal/mensual (con reclamo) cuando el cashback esta apagado. v177: reembolso DIARIO de vuelta + 'ya reembolsado' en semanal/mensual. v176: '¿Como funciona?' abre/cierra (toggle) + boton Cerrar. v175: dos formas de cargar (automatica / con un agente) con cambio facil. v174: etiquetas radiales centradas en la rueda + sin scroll horizontal. v173: escucha rewards_changed (reset de ruleta por usuario desde el panel). v172: cambiar contraseña — mínimo 6 caracteres (antes 8)
// v171: // v171: Mis datos dorado + cambiar contraseña · INFORMACIÓN en acordeón · ruletas premium (aro con luces, gajos ricos, cubo con logo)
// v170: // v170: fix — al loguearse desde el modo invitado, el casino carga el SSO y PREMIOS aparece sin recargar
// v169: // v169: botón 🪪 Mis datos siempre en el widget + 🎁 PREMIOS siempre visible
// v168: // v168: tocar afuera del recuadro cierra los modales (registro, recuperar clave, etc.)
// v167: // v167: modo invitado con skin PREMIUM (cabecera 1GIROX, tabs Ingresar/Crear cuenta, campos y botón dorados, accesos) + /css/guest.css
// v166: // v166: modo INVITADO — sin sesión se ve el casino de fondo y el widget con Ingresar/Registrarse (chau pantalla vieja de login)
// v165: // v165: la ruleta explica cómo funciona el % (tope del 100% + rollover) al ganar, en el hub y en Mi premio
// v164: // v164: ruleta de bienvenida marcada como usada cuando el 100% de 1ª carga ya se cobró (sin doble 100%)
// v163: // v163: info del hub — bonos con tope del 100%, rollover cuenta deportes, ruleta bienvenida solo auto-registro
// v162: // v162: cartel ¡Carga acreditada! muestra el bono y su ROLLOVER
// v161: // v161: sonido de mensaje nuevo (AudioContext desbloqueado con el primer gesto) + scroll instantáneo al último mensaje (sin smooth que se quedaba corto)
// v160: // v160: campana 🔔 ACTIVAR NOTIFICACIONES en la guía de instalación (1 toque → cartel Permitir; bloqueadas → cómo desbloquear)
// v159: botón 📣 Comunidad SIEMPRE visible en el widget del casino (href /go/comunidad; antes dependía del fetch de la config y en iPhone a veces no aparecía)
// v156: // v156: seccion INFORMACION del hub (reembolso completo + rollover, con valores reales del panel; deportes no cuenta)
// v155: // v155: tarjeta 'Tu Reembolso' simple — monto grande siempre visible, un boton, sin jerga
// v154: // v154: reembolso acumulativo DE POR VIDA (sin ventana de 30 dias — las ganancias restan para siempre)
// v153: // v153: reembolso ACUMULATIVO (30 dias, se junta hasta reclamar, al reclamar arranca de 0)
// v152: // v152: etiquetas de las ruedas escalonadas (no se pegan) + ruleta diaria con cooldown de 24h desde el ultimo giro y countdown
// v151: // v151: guia de instalacion con TUS DATOS PARA ENTRAR EN LA APP (usuario+clave con copiar) y paso 'entra con tus datos'
// v150: // v150: la Ruleta de Bienvenida desaparece del hub una vez reclamado/aplicado el premio
// v149: // v149: guia de instalacion propia del hub (pasos iPhone/Android + checks en vivo + derivar a soporte si no puede)
// v148: // v148: 'Reembolso en Vivo' (sin 'esperar al lunes') + guia de instalacion de app desde la tarjeta de la ruleta diaria
// v147: // v147: cashback sobre la perdida de la SEMANA en curso (ayer tambien cuenta) + aviso de app en ruleta diaria
// v146: // v146: recuadro 'TUS DATOS DE INGRESO' (usuario + clave con copiar) en el inicio del asistente
// v145: // v145: sacado del asistente el 'Estas como X' y el boton Cambiar de cuenta / Salir
// v144: // v144: boton Actualizar del cashback fuerza lectura FRESCA (cooldown 30s por usuario con aviso de espera)
// v143: // v143: cashback EN VIVO (auto-refresh cada 60s con el hub abierto + boton actualizar + 'hace Xs')
// v142: // v142: PREMIOS dentro del widget de Cargas Automaticas, hub con las 3 tarjetas siempre + explicacion de rollover (solo slots/ruleta)
// v141: // v141: hub PREMIOS (boton flotante + overlay) con ruleta de bienvenida, RULETA DIARIA y CASHBACK instantaneo
// v140: // v140: sin flash del login al recargar con sesion (splash 'Entrando al casino…' hasta que abre el casino)
// v139: // v139: 'Cambiar de cuenta' en el widget, logout que cierra el casino y mata la sesion de 1girox, SSO fresco (logout previo) — fix chat/casino con usuarios distintos
// v138: // v138: ruleta de bienvenida en OVERLAY a pantalla completa (rueda ~340px, resultado y botones ahi mismo) + pantalla "Mi premio" reabrible
// v137: ruleta legible dentro del chat (reemplazada por el overlay)
// v136: // v136: el panel del casino abre en el CUADRANTE de la burbuja (lado + arriba/abajo) y la burbuja se OCULTA mientras el chat esta abierto (no la tapa); la pista de arrastre se posiciona segun donde este la burbuja
const CACHE_NAME = 'sala-juegos-fcm-' + CACHE_VERSION;

// Logs por-fetch del SW (corren en CADA request). Apagados por default;
// poner SW_DEBUG = true para diagnosticar. Los logs de install/activate quedan.
const SW_DEBUG = false;
function _slog() { if (SW_DEBUG) console.log.apply(console, arguments); }

const PRECACHE_URLS = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Determina si un asset (no navegación) debe usar network-first.
// NOTA: Las navigation requests (modo 'navigate') se excluyen antes de
// llegar aquí, por lo que NO es necesario listar '/' ni '/index.html'.
function isNetworkFirst(url) {
  return (
    url.includes('/app.js') ||
    url.includes('/manifest.json')
  );
}

// Módulos JS/CSS propios: stale-while-revalidate — se sirven del caché
// (rápido, igual que antes) pero se revalidan en background, así un deploy
// llega a los clientes en la SIGUIENTE carga sin bumpear CACHE_VERSION a mano
// (causa raíz de los bugs "fantasma" de código viejo cacheado).
function isStaleWhileRevalidate(url) {
  try {
    var u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    // Se incluye /img/ (fondos del chat): son archivos que no cambian nunca y
    // pesan decenas de KB — servirlos del caché evita que el chat aparezca sin
    // fondo mientras cargan en una conexión lenta.
    return u.pathname.indexOf('/js/') === 0
        || u.pathname.indexOf('/css/') === 0
        || u.pathname.indexOf('/img/') === 0;
  } catch (e) {
    return false;
  }
}

// Verifica si una URL pertenece a Cloudflare u otros dominios de seguridad
// que NUNCA deben pasar por el caché del SW.
function isCloudflareOrSecurityUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'challenges.cloudflare.com' ||
      parsed.hostname.endsWith('.cloudflare.com') ||
      parsed.pathname.startsWith('/cdn-cgi/')
    );
  } catch (e) {
    return false;
  }
}

// ============================================
// CONFIGURACIÓN DE FIREBASE
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyAjZuVIxNY-SrnihkyNVupZ8AhXX6qxAxY",
  authDomain: "saladejuegos-673fa.firebaseapp.com",
  projectId: "saladejuegos-673fa",
  storageBucket: "saladejuegos-673fa.firebasestorage.app",
  messagingSenderId: "553123191180",
  appId: "1:553123191180:web:277eb460ef78dab8525ea9",
  measurementId: "G-3ZJRT0NCTE"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log('[FCM-SW] Firebase Messaging Service Worker v4 iniciado');

// ============================================
// NOTIFICACIONES EN BACKGROUND (FCM SDK)
// ============================================
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM-SW] Notificación en background:', payload);

  const notif = payload.notification || {};
  const webNotif = (payload.webpush && payload.webpush.notification) || {};

  const title = notif.title || webNotif.title || 'Sala de Juegos';
  const body  = notif.body  || webNotif.body  || 'Tienes un mensaje del soporte';
  const icon  = notif.icon  || webNotif.icon  || '/icons/icon-192x192.png';
  const badge = notif.badge || webNotif.badge || '/icons/icon-72x72.png';
  const tag   = (payload.data && payload.data.tag) || 'chat-message';

  // Confirmación de entrega: si el envío vino con batchId+userId, avisar al
  // backend que el push llegó realmente (cubre el falso "enviado" cuando
  // FCM acepta el mensaje pero la subscription estaba muerta).
  const _data = payload.data || {};
  if (_data.batchId && _data.userId) {
    fetch('/api/notifications/confirm-delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: _data.batchId, userId: _data.userId }),
      keepalive: true
    }).catch(function (err) {
      console.warn('[FCM-SW] confirm-delivery falló:', err && err.message);
    });
  }

  const options = {
    body,
    icon,
    badge,
    tag,
    requireInteraction: false,
    data: _data,
    actions: [
      { action: 'open',  title: 'Abrir chat' },
      { action: 'close', title: 'Cerrar'     }
    ],
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(title, options);
});

// ============================================
// CLICK EN NOTIFICACIÓN
// ============================================
self.addEventListener('notificationclick', function(event) {
  console.log('[FCM-SW] Click en notificación:', event.action);

  event.notification.close();

  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// ============================================
// INSTALACIÓN
// ============================================
self.addEventListener('install', function(event) {
  console.log('[FCM-SW] Instalando', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .catch(function(err) {
        console.log('[FCM-SW] Error al pre-cachear:', err);
      })
  );

  self.skipWaiting();
});

// ============================================
// ACTIVACIÓN
// ============================================
self.addEventListener('activate', function(event) {
  console.log('[FCM-SW] Activado', CACHE_VERSION);

  // IMPORTANT: clients.claim() must be inside event.waitUntil so that
  // navigator.serviceWorker.ready only resolves AFTER the SW is actually
  // controlling the page. If claim() is called outside waitUntil, the
  // ready promise may resolve before navigator.serviceWorker.controller
  // is set, causing getToken() to fail in standalone/PWA mode because
  // FCM internally checks the controller state.
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[FCM-SW] Eliminando caché antiguo:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ============================================
// FETCH (ESTRATEGIA DE CACHÉ)
// ============================================
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // PWA WEBAPK FIX: responder a navigation requests con fetch de red
  // (sin caché). Esto es imprescindible para que Chrome Android verifique
  // que el SW controla start_url y genere un WebAPK real en lugar de un
  // acceso directo. redirect:'manual' devuelve opaqueredirect para
  // redirecciones cross-origin (p. ej. Cloudflare Challenge), que Chrome
  // sigue de forma nativa sin que el SW actúe como proxy.
  if (event.request.mode === 'navigate') {
    _slog('[FCM-SW] Navigation request - respondiendo con red (sin caché):', url);
    event.respondWith(
      fetch(event.request, { redirect: 'manual' })
        .catch(function() {
          _slog('[FCM-SW] Red no disponible para navegación:', url);
          return new Response('Sin conexión - por favor verificá tu internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Excluir URLs de Cloudflare, cdn-cgi y cualquier dominio de seguridad.
  if (isCloudflareOrSecurityUrl(url)) {
    _slog('[FCM-SW] URL de seguridad excluida del caché:', url);
    return;
  }

  // Excluir API y sockets: siempre van a red.
  if (url.includes('/api/') || url.includes('/socket.io/')) return;

  if (isStaleWhileRevalidate(url)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var network = fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var toCache = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, toCache);
            });
          }
          return response;
        }).catch(function() {
          // Sin red: si había caché ya se devolvió; si no, propagar el fallo.
          return cached;
        });
        return cached || network;
      })
    );
    return;
  }

  if (isNetworkFirst(url)) {
    // Network-first: siempre intenta red para que los deploys sean inmediatos.
    _slog('[FCM-SW] Network-first para:', url);
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var toCache = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, toCache);
            });
          }
          return response;
        })
        .catch(function() {
          _slog('[FCM-SW] Red no disponible, buscando en caché:', url);
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first para assets estáticos estables (iconos, fuentes, etc.)
    event.respondWith(
      caches.match(event.request)
        .then(function(cached) {
          if (cached) {
            _slog('[FCM-SW] Cache hit para:', url);
            return cached;
          }
          _slog('[FCM-SW] Cache miss - red para:', url);
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200 && response.type === 'basic') {
              var toCache = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, toCache);
              });
            }
            return response;
          });
        })
        .catch(function() {
          return undefined;
        })
    );
  }
});

// ============================================
// MENSAJES DESDE LA APP
// ============================================
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
