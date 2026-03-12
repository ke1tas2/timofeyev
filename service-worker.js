// ============================================================
// service-worker.js — Timofeyev Transfer PWA
// Полная поддержка push-уведомлений (все роли)
// ============================================================

const CACHE_NAME = 'timofeyev-v1.0.3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/api.js',
  '/push.js',
  '/offline.html',
  '/assets/car-keys.png',
  '/assets/sedan.png',
  '/assets/suv.png',
  '/assets/sportcar.png',
  '/assets/microbus.png',
  '/assets/limousine-black.png',
  '/assets/bus.png',
  '/assets/helicopter-black.png',
  '/assets/plane.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// ── Иконки для разных типов уведомлений ─────────────────────
const NOTIF_ICONS = {
  // Клиент
  order_searching:         '/assets/icons/icon-192.png',
  order_accepted:          '/assets/icons/icon-192.png',
  driver_arriving:         '/assets/icons/icon-192.png',
  trip_started:            '/assets/icons/icon-192.png',
  trip_completed:          '/assets/icons/icon-192.png',
  order_cancelled_driver:  '/assets/icons/icon-192.png',
  rating_received:         '/assets/icons/icon-192.png',
  // Водитель
  new_order:               '/assets/icons/icon-192.png',
  order_cancelled_client:  '/assets/icons/icon-192.png',
  application_approved:    '/assets/icons/icon-192.png',
  application_rejected:    '/assets/icons/icon-192.png',
  driver_online:           '/assets/icons/icon-192.png',
  // Администратор
  new_driver_application:  '/assets/icons/icon-192.png',
  order_completed:         '/assets/icons/icon-192.png',
  order_cancelled:         '/assets/icons/icon-192.png',
  low_rating_driver:       '/assets/icons/icon-192.png',
  // Общие
  broadcast:               '/assets/icons/icon-192.png',
};

// ── УСТАНОВКА ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── АКТИВАЦИЯ ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ success: false, message: 'Нет подключения' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  if (!url.hostname.includes('timofeev.kz')) {
    event.respondWith(fetch(request).catch(() => new Response('')));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.destination === 'document') return caches.match('/offline.html');
      });
    })
  );
});

// ── PUSH УВЕДОМЛЕНИЯ ────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = null;

  // Пытаемся разобрать payload
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'Timofeyev', body: event.data.text() };
    }
  }

  // Если payload пришёл — показываем сразу
  if (payload) {
    event.waitUntil(showPushNotification(payload));
    // Уведомляем все открытые вкладки
    notifyClients(payload);
  } else {
    // Без payload — пустой триггер, клиент сам опросит API
    event.waitUntil(
      self.registration.showNotification('Timofeyev', {
        body:  'У вас новое уведомление',
        icon:  '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-96.png',
        data:  { url: '/' },
      })
    );
  }
});

// ── Показать уведомление ─────────────────────────────────────
function showPushNotification(payload) {
  const title   = payload.title || 'Timofeyev';
  const body    = payload.body  || '';
  const type    = payload.type  || 'default';
  const url     = payload.url   || getDefaultUrl(type);
  const icon    = NOTIF_ICONS[type] || '/assets/icons/icon-192.png';

  // Кнопки действий зависят от типа уведомления
  const actions = getActions(type, payload.data);

  const options = {
    body,
    icon,
    badge:   '/assets/icons/icon-192.png',
    vibrate: getVibrationPattern(type),
    silent:  false,
    requireInteraction: isImportant(type),
    data:    { url, type, orderData: payload.data || {} },
    actions,
    tag:     getTag(type, payload.data),       // группировка одинаковых уведомлений
    renotify: shouldRenotify(type),
  };

  return self.registration.showNotification(title, options);
}

// ── Определить URL по типу ───────────────────────────────────
function getDefaultUrl(type) {
  const driverTypes = ['new_order', 'order_cancelled_client', 'trip_started', 'trip_completed', 'driver_online', 'driver_offline', 'application_approved', 'application_rejected', 'driver_suspended', 'rating_received'];
  const adminTypes  = ['new_driver_application', 'new_order', 'order_completed', 'order_cancelled', 'low_rating_driver', 'account_blocked'];

  if (driverTypes.includes(type)) return '/driver.html';
  if (adminTypes.includes(type))  return '/admin.html';
  return '/';
}

// ── Кнопки действий по типу ─────────────────────────────────
function getActions(type, data) {
  switch (type) {
    case 'new_order':
      return [
        { action: 'accept', title: '✅ Принять', icon: '/assets/icons/icon-192.png' },
        { action: 'skip',   title: '⏭ Пропустить' },
      ];
    case 'trip_completed':
    case 'order_accepted':
      return [
        { action: 'open',  title: '👁 Открыть' },
        { action: 'close', title: '✕ Закрыть' },
      ];
    case 'rating_received':
      return [
        { action: 'open',  title: '⭐ Посмотреть' },
        { action: 'close', title: '✕ Закрыть' },
      ];
    case 'new_driver_application':
      return [
        { action: 'review', title: '👁 Рассмотреть' },
        { action: 'close',  title: '✕ Позже' },
      ];
    default:
      return [
        { action: 'open',  title: 'Открыть' },
        { action: 'close', title: 'Закрыть' },
      ];
  }
}

// ── Паттерн вибрации ─────────────────────────────────────────
function getVibrationPattern(type) {
  // Длинная вибрация для важных событий
  if (['new_order', 'new_driver_application', 'low_rating_driver'].includes(type)) {
    return [200, 100, 200, 100, 200];
  }
  // Стандартная
  return [100, 50, 100];
}

// ── Требует ли уведомление взаимодействия ───────────────────
function isImportant(type) {
  return ['new_order', 'new_driver_application', 'driver_arriving', 'low_rating_driver'].includes(type);
}

// ── Тег для группировки ─────────────────────────────────────
function getTag(type, data) {
  if (data?.order_id) return `order-${data.order_id}-${type}`;
  return type;
}

// ── Перепоказать даже если уведомление с тем же тегом уже есть
function shouldRenotify(type) {
  return ['new_order', 'driver_arriving'].includes(type);
}

// ── Уведомить открытые вкладки (для in-app тоста) ───────────
function notifyClients(payload) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type:  'PUSH_RECEIVED',
        title: payload.title,
        body:  payload.body,
        notifType: payload.type,
        data:  payload.data,
      });
    });
  });
}

// ── КЛИК ПО УВЕДОМЛЕНИЮ ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action    = event.action;
  const notifData = event.notification.data || {};
  const type      = notifData.type || '';
  const orderData = notifData.orderData || {};

  if (action === 'close' || action === 'skip') return;

  let targetUrl = notifData.url || '/';

  // Для действия "принять заказ" — открываем driver.html с параметром
  if (action === 'accept' && orderData.order_id) {
    targetUrl = `/driver.html?accept_order=${orderData.order_id}`;
  }
  // Для "рассмотреть заявку" — открываем admin.html на разделе водителей
  if (action === 'review') {
    targetUrl = '/admin.html?section=drivers';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Если уже открыта нужная вкладка — фокусируем её
      for (const client of list) {
        const clientUrl = new URL(client.url);
        const targetParsed = new URL(targetUrl, self.location.origin);
        if (clientUrl.pathname === targetParsed.pathname && 'focus' in client) {
          // Передаём данные о действии открытой вкладке
          client.postMessage({ type: 'NOTIFICATION_CLICK', action, notifType: type, data: orderData });
          return client.focus();
        }
      }
      // Открываем новую вкладку
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── ЗАКРЫТИЕ УВЕДОМЛЕНИЯ ────────────────────────────────────
self.addEventListener('notificationclose', (event) => {
  const type = event.notification.data?.type || '';
  // Логируем отклонённые важные уведомления (опционально, через beacon API)
  // navigator.sendBeacon можно использовать для аналитики
});