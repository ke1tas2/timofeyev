<?php
// ============================================================
// routes/profile.php — Личный кабинет пользователя
// ============================================================
// GET  /api/profile/addresses       — сохранённые адреса
// POST /api/profile/addresses       — добавить адрес
// DELETE /api/profile/addresses/:id — удалить
// GET  /api/profile/payments        — способы оплаты
// POST /api/profile/payments        — добавить карту
// DELETE /api/profile/payments/:id  — удалить карту
// POST /api/profile/promo           — применить промокод
// GET  /api/profile/notifications   — уведомления
// PATCH /api/profile/notifications/read — отметить прочитанными

$user = Auth::require();
$action = $segments[1] ?? '';
$subId  = isset($segments[2]) && is_numeric($segments[2]) ? (int)$segments[2] : null;

// ── АДРЕСА ───────────────────────────────────────────────────
if ($action === 'addresses') {
    if ($method === 'GET') {
        $addresses = Database::query(
            'SELECT * FROM saved_addresses WHERE user_id=? ORDER BY id',
            [$user['id']]
        );
        Response::ok($addresses);
    }
    if ($method === 'POST') {
        $label   = trim($body['label'] ?? '');
        $address = trim($body['address'] ?? '');
        $lat = $body['lat'] ?? null;
        $lng = $body['lng'] ?? null;
        if (!$address || !$lat || !$lng) Response::error('Адрес, lat и lng обязательны');
        $id = Database::insert(
            'INSERT INTO saved_addresses (user_id, label, address, lat, lng, icon) VALUES (?,?,?,?,?,?)',
            [$user['id'], $label ?: 'Адрес', $address, (float)$lat, (float)$lng, $body['icon'] ?? 'map-marker-alt']
        );
        Response::ok(['id' => $id], 'Адрес сохранён', 201);
    }
    if ($method === 'DELETE' && $subId) {
        Database::exec('DELETE FROM saved_addresses WHERE id=? AND user_id=?', [$subId, $user['id']]);
        Response::ok(null, 'Адрес удалён');
    }
}

// ── СПОСОБЫ ОПЛАТЫ ──────────────────────────────────────────
if ($action === 'payments') {
    if ($method === 'GET') {
        $methods = Database::query(
            'SELECT id, type, card_last4, card_brand, is_default FROM payment_methods WHERE user_id=? ORDER BY is_default DESC, id',
            [$user['id']]
        );
        // Добавляем "Наличные" по умолчанию
        array_unshift($methods, ['id' => 'cash', 'type' => 'cash', 'card_last4' => null, 'card_brand' => null, 'is_default' => 0]);
        Response::ok($methods);
    }
    if ($method === 'POST') {
        // В реальном проекте — интеграция с CloudPayments / Kaspi Pay и т.д.
        $last4 = substr(preg_replace('/\D/', '', $body['card_number'] ?? ''), -4);
        if (strlen($last4) < 4) Response::error('Неверный номер карты');
        $brand = isset($body['card_number'][0]) && $body['card_number'][0] === '4' ? 'Visa' : 'MasterCard';
        // Снять статус default у остальных
        if (!empty($body['is_default'])) {
            Database::exec('UPDATE payment_methods SET is_default=0 WHERE user_id=?', [$user['id']]);
        }
        $id = Database::insert(
            'INSERT INTO payment_methods (user_id, type, card_last4, card_brand, is_default) VALUES (?,?,?,?,?)',
            [$user['id'], 'card', $last4, $brand, empty($body['is_default']) ? 0 : 1]
        );
        Response::ok(['id' => $id, 'last4' => $last4, 'brand' => $brand], 'Карта добавлена', 201);
    }
    if ($method === 'DELETE' && $subId) {
        Database::exec('DELETE FROM payment_methods WHERE id=? AND user_id=?', [$subId, $user['id']]);
        Response::ok(null, 'Карта удалена');
    }
}

// ── ПРОМОКОД ─────────────────────────────────────────────────
if ($action === 'promo' && $method === 'POST') {
    $code = strtoupper(trim($body['code'] ?? ''));
    if (!$code) Response::error('Введите промокод');

    $promo = Database::row(
        "SELECT * FROM promo_codes 
         WHERE code=? AND is_active=1
           AND (max_uses IS NULL OR used_count < max_uses)
           AND (valid_from IS NULL OR valid_from <= NOW())
           AND (valid_to   IS NULL OR valid_to   >= NOW())",
        [$code]
    );
    if (!$promo) Response::error('Промокод недействителен или истёк');

    Response::ok([
        'code'           => $promo['code'],
        'discount_type'  => $promo['discount_type'],
        'discount_value' => $promo['discount_value'],
    ], 'Промокод применён');
}

// ── УВЕДОМЛЕНИЯ ─────────────────────────────────────────────
if ($action === 'notifications') {
    if ($method === 'GET') {
        $notifs = Database::query(
            'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
            [$user['id']]
        );
        $unread = Database::scalar(
            'SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0',
            [$user['id']]
        );
        Response::ok(['notifications' => $notifs, 'unread' => (int)$unread]);
    }
    if ($method === 'PATCH' && $subaction === 'read') {
        Database::exec('UPDATE notifications SET is_read=1 WHERE user_id=?', [$user['id']]);
        Response::ok(null, 'Отмечено как прочитанное');
    }
}

Response::notFound("Profile: неизвестный раздел '$action'");
