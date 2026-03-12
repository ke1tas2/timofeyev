<?php
// ============================================================
// routes/push.php — Управление push-подписками
// ============================================================
// POST   /api/push/subscribe    — сохранить подписку
// DELETE /api/push/unsubscribe  — удалить подписку
// GET    /api/push/vapid-key    — публичный VAPID ключ (публичный)
// GET    /api/notifications     — история уведомлений
// PATCH  /api/notifications/read — отметить прочитанными

$action = $segments[1] ?? '';

// ── GET /api/push/vapid-key — публичный, без авторизации ────
if ($method === 'GET' && $action === 'vapid-key') {
    Response::ok(['public_key' => $config['vapid']['public_key']]);
}

// Все остальные эндпоинты — требуют авторизации
$user = Auth::require();

// ── POST /api/push/subscribe ─────────────────────────────────
if ($method === 'POST' && $action === 'subscribe') {
    $endpoint = trim($body['endpoint'] ?? '');
    $p256dh   = trim($body['keys']['p256dh'] ?? '');
    $auth     = trim($body['keys']['auth']   ?? '');

    if (!$endpoint || !$p256dh || !$auth) {
        Response::error('endpoint, keys.p256dh и keys.auth обязательны');
    }

    // Upsert подписки
    $existing = Database::row('SELECT id FROM push_subscriptions WHERE endpoint = ?', [$endpoint]);
    if ($existing) {
        Database::exec(
            'UPDATE push_subscriptions SET user_id=?, p256dh=?, auth=?, user_agent=? WHERE endpoint=?',
            [$user['id'], $p256dh, $auth, $_SERVER['HTTP_USER_AGENT'] ?? null, $endpoint]
        );
    } else {
        Database::insert(
            'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?,?)',
            [$user['id'], $endpoint, $p256dh, $auth, $_SERVER['HTTP_USER_AGENT'] ?? null]
        );
    }

    Response::ok(null, 'Подписка сохранена');
}

// ── DELETE /api/push/unsubscribe ─────────────────────────────
if ($method === 'DELETE' && $action === 'unsubscribe') {
    $endpoint = trim($body['endpoint'] ?? '');
    if ($endpoint) {
        Database::exec(
            'DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?',
            [$endpoint, $user['id']]
        );
    } else {
        // Удалить все подписки пользователя
        Database::exec('DELETE FROM push_subscriptions WHERE user_id=?', [$user['id']]);
    }
    Response::ok(null, 'Подписка удалена');
}

Response::notFound("Push: неизвестный маршрут '$action'");
