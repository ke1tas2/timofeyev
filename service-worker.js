// ============================================================
// service-worker.js — Timofeyev Transfer PWA
// ============================================================

const CACHE_NAME = 'timofeyev-v1.0.0';

// Файлы для кэширования при установке (App Shell)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/api.js',
  '/assets/car-keys.png',
  '/assets/sedan.png',
  '/assets/suv.png',
  '/assets/sportcar.png',
  '/assets/microbus.png',
  '/assets/limousine-black.png',
  '/assets/bus.png',
  '/assets/helicopter-black.png',
  '/assets/plane.png',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/offline.html',
];

// ── УСТАНОВКА: кэшируем App Shell ────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Кэшируем App Shell...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── АКТИВАЦИЯ: удаляем старые кэши ──────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Удаляем старый кэш:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── СТРАТЕГИИ КЭШИРОВАНИЯ ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API запросы — только сеть (Network Only)
  // Нельзя кэшировать заказы, авторизацию и т.д.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ success: false, message: 'Нет подключения к интернету' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Яндекс карты и внешние ресурсы — только сеть
  if (!url.origin.includes('timofeyev.kz')) {
    event.respondWith(fetch(request));
    return;
  }

  // Статические файлы — Cache First (сначала кэш, потом сеть)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Кэшируем только успешные ответы
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Если страница недоступна — показываем офлайн-страницу
          if (request.destination === 'document') {
            return caches.match('/offline.html');
          }
        });
    })
  );
});

// ── PUSH УВЕДОМЛЕНИЯ ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Timofeyev', body: 'У вас новое уведомление' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'close', title: 'Закрыть' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Timofeyev', options)
  );
});

// ── КЛИК ПО УВЕДОМЛЕНИЮ ──────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
