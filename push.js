/* =============================================================
   push.js — Управление Web Push уведомлениями
   Timofeyev Transfer PWA
   Подключить в index.html, admin.html, driver.html ПОСЛЕ api.js:
   <script src="/push.js?v=1.0.0"></script>
   ============================================================= */

const TFPush = (function () {

    const API_BASE = 'https://calc.timofeev.kz/api';

    // ── Проверка поддержки ───────────────────────────────────
    function isSupported() {
        return 'serviceWorker' in navigator
            && 'PushManager' in window
            && 'Notification' in window;
    }

    // ── Конвертация VAPID public key ─────────────────────────
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw     = window.atob(base64);
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    // ── Получить VAPID public key с сервера ──────────────────
    async function getVapidPublicKey() {
        try {
            const res = await fetch(`${API_BASE}/push/vapid-key`);
            const json = await res.json();
            return json.data?.public_key || null;
        } catch {
            return null;
        }
    }

    // ── Сохранить подписку на сервере ────────────────────────
    async function saveSubscription(subscription) {
        const token = localStorage.getItem('tf_token');
        if (!token) return false;

        const sub = subscription.toJSON();
        try {
            const res = await fetch(`${API_BASE}/push/subscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.keys.p256dh,
                        auth:   sub.keys.auth,
                    },
                }),
            });
            const json = await res.json();
            return json.success;
        } catch {
            return false;
        }
    }

    // ── Удалить подписку с сервера ────────────────────────────
    async function removeSubscription(endpoint) {
        const token = localStorage.getItem('tf_token');
        if (!token) return;
        try {
            await fetch(`${API_BASE}/push/unsubscribe`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ endpoint }),
            });
        } catch {}
    }

    // ── Главная функция — запрос разрешения и подписка ───────
    async function subscribe() {
        if (!isSupported()) {
            console.log('[TFPush] Push не поддерживается браузером');
            return false;
        }

        // Не запрашиваем повторно если уже заблокировано
        if (Notification.permission === 'denied') {
            console.log('[TFPush] Уведомления заблокированы пользователем');
            return false;
        }

        try {
            // Регистрация Service Worker (если ещё не зарегистрирован)
            const reg = await navigator.serviceWorker.ready;

            // Проверяем существующую подписку
            let subscription = await reg.pushManager.getSubscription();

            if (!subscription) {
                // Получаем VAPID публичный ключ
                const vapidKey = await getVapidPublicKey();
                if (!vapidKey) {
                    console.error('[TFPush] Не удалось получить VAPID ключ');
                    return false;
                }

                // Запрашиваем разрешение
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.log('[TFPush] Пользователь отклонил уведомления');
                    return false;
                }

                // Создаём подписку
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidKey),
                });
            }

            // Сохраняем на сервере
            const saved = await saveSubscription(subscription);
            if (saved) {
                localStorage.setItem('tf_push_subscribed', '1');
                console.log('[TFPush] ✅ Подписка сохранена на сервере');
            }
            return saved;

        } catch (err) {
            console.error('[TFPush] Ошибка подписки:', err);
            return false;
        }
    }

    // ── Отписка ──────────────────────────────────────────────
    async function unsubscribe() {
        if (!isSupported()) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const subscription = await reg.pushManager.getSubscription();
            if (subscription) {
                await removeSubscription(subscription.endpoint);
                await subscription.unsubscribe();
            }
            localStorage.removeItem('tf_push_subscribed');
            console.log('[TFPush] Подписка отменена');
        } catch (err) {
            console.error('[TFPush] Ошибка отписки:', err);
        }
    }

    // ── Автоматическая подписка после авторизации ────────────
    // Вызывается из script.js в finishAuth() 
    async function init() {
        if (!isSupported()) return;
        if (!localStorage.getItem('tf_token')) return;

        // Обновляем кнопку сразу при загрузке
        updateNotifButton();

        setTimeout(async () => {
            const alreadyGranted = Notification.permission === 'granted';
            const alreadySubscribed = localStorage.getItem('tf_push_subscribed') === '1';

            // ТИХО обновляем подписку ТОЛЬКО если разрешение уже было дано ранее
            if (alreadyGranted && !alreadySubscribed) {
                console.log('[TFPush] Разрешение уже есть, тихо обновляем подписку на сервере...');
                await subscribe(); 
            }
            updateNotifButton();
        }, 2000);
    }

    // ── Обновить внешний вид кнопки уведомлений ─────────────
    function updateNotifButton() {
        const btn      = document.getElementById('btn-enable-notif');
        const title    = document.getElementById('notif-btn-title');
        const subtitle = document.getElementById('notif-btn-subtitle');
        const bellIcon = document.getElementById('notif-btn-bell-icon');
        const chevron  = document.getElementById('notif-btn-chevron');

        if (!btn) return;

        const perm = ('Notification' in window) ? Notification.permission : 'default';

        if (perm === 'granted') {
            // Уведомления включены
            if (title)    title.textContent = 'Уведомления включены';
            if (subtitle) { subtitle.textContent = 'Нажмите для управления'; subtitle.style.display = ''; }
            if (bellIcon) { bellIcon.className = 'fas fa-bell'; bellIcon.style.color = '#c9a227'; }
            if (chevron)  chevron.style.display = '';
            btn.onclick = function() { closeHsMenu(); };
        } else if (perm === 'denied') {
            // Заблокировано пользователем
            if (title)    title.textContent = 'Уведомления заблокированы';
            if (subtitle) { subtitle.textContent = 'Разрешите в настройках браузера'; subtitle.style.display = ''; }
            if (bellIcon) { bellIcon.className = 'fas fa-bell-slash'; bellIcon.style.color = '#888'; }
            if (chevron)  chevron.style.display = 'none';
            btn.onclick = function() { closeHsMenu(); };
        } else {
            // Не задано — предлагаем включить
            if (title)    title.textContent = 'Включите уведомления';
            if (subtitle) { subtitle.textContent = 'Нажмите чтобы включить'; subtitle.style.display = ''; }
            if (bellIcon) { bellIcon.className = 'fas fa-bell'; bellIcon.style.color = ''; }
            if (chevron)  chevron.style.display = '';
            btn.onclick = function() { closeHsMenu(); TFPush.promptPermission(); };
        }
    }

    // ── Показать запрос разрешения (вызывать с кнопки) ────────
    async function promptPermission() {
        if (!isSupported()) {
            alert('Ваш браузер не поддерживает push-уведомления');
            return false;
        }
        const result = await subscribe();
        updateNotifButton(); // Обновляем кнопку после получения ответа
        return result;
    }

    // ── Показать тестовое уведомление ────────────────────────
    function showLocalNotification(title, body, url = '/') {
        if (!isSupported() || Notification.permission !== 'granted') return;
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, {
                body,
                icon:    '/assets/icons/icon-192.png',
                badge:   '/assets/icons/icon-192.png',
                vibrate: [100, 50, 100],
                data:    { url },
                actions: [
                    { action: 'open',  title: 'Открыть' },
                    { action: 'close', title: 'Закрыть' },
                ],
            });
        });
    }

    // ── Счётчик непрочитанных ────────────────────────────────
    let _unreadCount = 0;
    async function fetchUnreadCount() {
        const token = localStorage.getItem('tf_token');
        if (!token) return 0;
        try {
            const res  = await fetch(`${API_BASE}/notifications`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            _unreadCount = json.data?.unread || 0;
            updateBadge(_unreadCount);
            return _unreadCount;
        } catch {
            return 0;
        }
    }

    function updateBadge(count) {
        // Обновляем иконки счётчика в UI
        document.querySelectorAll('.notif-badge').forEach(el => {
            el.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
            el.style.display = count > 0 ? 'flex' : 'none';
        });
        // Обновляем title вкладки
        const base = 'Timofeyev';
        document.title = count > 0 ? `(${count}) ${base}` : base;
    }

    async function markAllRead() {
        const token = localStorage.getItem('tf_token');
        if (!token) return;
        try {
            await fetch(`${API_BASE}/notifications/read`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            _unreadCount = 0;
            updateBadge(0);
        } catch {}
    }

    // ── Периодическая проверка уведомлений ──────────────────
    // (резервный механизм, если push недоступен)
    let _pollInterval = null;
    function startPolling(intervalMs = 30000) {
        if (_pollInterval) return;
        fetchUnreadCount();
        _pollInterval = setInterval(fetchUnreadCount, intervalMs);
    }
    function stopPolling() {
        if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    }

    // ── Слушаем сообщения от Service Worker ─────────────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data || {};
            if (data.type === 'PUSH_RECEIVED') {
                // SW получил push — обновляем счётчик
                fetchUnreadCount();
                // Показываем in-app тост
                showToast(data.title || 'Новое уведомление', data.body || '');
            }
        });
    }

    // ── In-app тост-уведомление ──────────────────────────────
    function showToast(title, body) {
        const existing = document.getElementById('tf-push-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'tf-push-toast';
        toast.innerHTML = `
            <div class="tf-toast-icon">🔔</div>
            <div class="tf-toast-text">
                <div class="tf-toast-title">${escapeHtml(title)}</div>
                ${body ? `<div class="tf-toast-body">${escapeHtml(body)}</div>` : ''}
            </div>
            <button class="tf-toast-close" onclick="this.parentElement.remove()">✕</button>
        `;
        document.body.appendChild(toast);

        // Анимация появления
        requestAnimationFrame(() => toast.classList.add('tf-toast-show'));

        // Автоскрытие через 5 секунд
        setTimeout(() => {
            toast.classList.remove('tf-toast-show');
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
    }

    // ── Инициализация при загрузке страницы ─────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // Запускаем polling как резервный механизм
        if (localStorage.getItem('tf_token')) {
            startPolling(30000);
        }

        // Добавляем CSS для тостов (инлайн, чтобы не зависеть от styles.css)
        if (!document.getElementById('tf-push-style')) {
            const style = document.createElement('style');
            style.id = 'tf-push-style';
            style.textContent = `
                #tf-push-toast {
                    position: fixed;
                    top: -80px;
                    left: 50%;
                    transform: translateX(-50%);
                    min-width: 300px;
                    max-width: calc(100vw - 32px);
                    background: #1c1c1e;
                    color: #fff;
                    border-radius: 16px;
                    padding: 14px 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    z-index: 99999;
                    transition: top 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                    border: 1px solid rgba(255,255,255,0.08);
                }
                #tf-push-toast.tf-toast-show { top: 16px; }
                .tf-toast-icon { font-size: 20px; flex-shrink: 0; }
                .tf-toast-text { flex: 1; min-width: 0; }
                .tf-toast-title { font-weight: 700; font-size: 14px; line-height: 1.3; }
                .tf-toast-body  { font-size: 12px; color: #aeaeb2; margin-top: 2px;
                                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .tf-toast-close {
                    background: none; border: none; color: #636366;
                    font-size: 16px; cursor: pointer; padding: 4px; flex-shrink: 0;
                }
                .notif-badge {
                    background: #fc3f1e; color: #fff; border-radius: 50%;
                    min-width: 18px; height: 18px; font-size: 11px; font-weight: 700;
                    display: none; align-items: center; justify-content: center;
                    padding: 0 4px;
                }
            `;
            document.head.appendChild(style);
        }
    });

    // ── Публичный API ────────────────────────────────────────
    return {
        init,
        updateNotifButton,
        subscribe,
        unsubscribe,
        promptPermission,
        showLocalNotification,
        fetchUnreadCount,
        markAllRead,
        startPolling,
        stopPolling,
        showToast,
        isSupported,
    };

})();

// ── Автоинициализация при входе ─────────────────────────────
// Перехватываем finishAuth из script.js
(function () {
    const _orig = window.finishAuth;
    window.finishAuth = function (user) {
        if (_orig) _orig.call(this, user);
        // После успешного входа — подписываемся на push
        TFPush.init();
    };
})();