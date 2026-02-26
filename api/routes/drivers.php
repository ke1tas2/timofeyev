<?php
// ============================================================
// routes/drivers.php — Раздел водителя
// ============================================================
// POST  /api/drivers/apply         — подать заявку водителем
// GET   /api/drivers/me            — мой профиль водителя
// PUT   /api/drivers/me            — обновить данные машины
// PATCH /api/drivers/location      — обновить геопозицию
// PATCH /api/drivers/status        — онлайн / оффлайн
// GET   /api/drivers/orders        — доступные заказы (pending)

$user = Auth::require();

$action = is_numeric($segments[1] ?? '') ? '' : ($segments[1] ?? '');

// ── POST /api/drivers/apply ──────────────────────────────────
if ($method === 'POST' && $action === 'apply') {
    // Проверяем — не подавал ли уже
    $existing = Database::row('SELECT id, status FROM drivers WHERE user_id=?', [$user['id']]);
    if ($existing) {
        $map = ['pending' => 'на рассмотрении', 'approved' => 'одобрена', 'rejected' => 'отклонена'];
        Response::error('Ваша заявка уже ' . ($map[$existing['status']] ?? $existing['status']));
    }

    Database::transaction(function() use ($user, $body) {
        Database::insert(
            'INSERT INTO drivers
             (user_id, car_make, car_model, car_year, car_color, car_number, car_class, license_number, status)
             VALUES (?,?,?,?,?,?,?,?,?)',
            [
                $user['id'],
                $body['car_make']       ?? null,
                $body['car_model']      ?? null,
                $body['car_year']       ?? null,
                $body['car_color']      ?? null,
                $body['car_number']     ?? null,
                $body['car_class']      ?? 'comfort',
                $body['license_number'] ?? null,
                'pending',
            ]
        );
        // Меняем роль пользователя
        Database::exec("UPDATE users SET role='driver' WHERE id=?", [$user['id']]);
    });

    Response::ok(null, 'Заявка отправлена. Мы свяжемся с вами в течение 24 часов.', 201);
}

// Для остальных actions — пользователь должен быть водителем
if ($user['role'] !== 'driver' && $user['role'] !== 'admin') {
    Response::forbidden('Только для водителей');
}

$driver = Database::row('SELECT * FROM drivers WHERE user_id=?', [$user['id']]);
if (!$driver && $user['role'] !== 'admin') Response::error('Профиль водителя не найден');

// ── GET /api/drivers/me ──────────────────────────────────────
if ($method === 'GET' && $action === 'me') {
    Response::ok(array_merge($driver ?? [], [
        'name'  => $user['name'],
        'phone' => $user['phone'],
    ]));
}

// ── PUT /api/drivers/me ──────────────────────────────────────
if ($method === 'PUT' && $action === 'me') {
    $fields = ['car_make','car_model','car_year','car_color','car_number','car_class','license_number'];
    $sets   = [];
    $params = [];
    foreach ($fields as $f) {
        if (array_key_exists($f, $body)) {
            $sets[]   = "$f = ?";
            $params[] = $body[$f];
        }
    }
    if ($sets) {
        $params[] = $user['id'];
        Database::exec('UPDATE drivers SET ' . implode(', ',$sets) . ' WHERE user_id=?', $params);
    }
    Response::ok(null, 'Данные обновлены');
}

// ── PATCH /api/drivers/location ─────────────────────────────
if ($method === 'PATCH' && $action === 'location') {
    $lat = $body['lat'] ?? null;
    $lng = $body['lng'] ?? null;
    if (!$lat || !$lng) Response::error('lat и lng обязательны');

    Database::exec(
        'UPDATE drivers SET current_lat=?, current_lng=? WHERE user_id=?',
        [(float)$lat, (float)$lng, $user['id']]
    );

    // Если у водителя есть активный заказ — можно отдавать координаты клиенту
    Response::ok(['lat' => (float)$lat, 'lng' => (float)$lng]);
}

// ── PATCH /api/drivers/status ────────────────────────────────
if ($method === 'PATCH' && $action === 'status') {
    if ($driver['status'] !== 'approved') {
        Response::error('Ваша заявка ещё не одобрена');
    }
    $online = (bool)($body['is_online'] ?? false);
    Database::exec('UPDATE drivers SET is_online=? WHERE user_id=?', [(int)$online, $user['id']]);
    Response::ok(['is_online' => $online], $online ? 'Вы онлайн' : 'Вы оффлайн');
}

// ── GET /api/drivers/orders — доступные заказы ─────────────
if ($method === 'GET' && $action === 'orders') {
    if ($driver['status'] !== 'approved' || !$driver['is_online']) {
        Response::error('Вы должны быть онлайн и одобренным водителем');
    }

    $orders = Database::query(
        "SELECT o.id, o.from_address, o.to_address, o.price, o.distance_km, 
            o.transport_class, o.payment_method, o.created_at,
            t.name AS tariff_name,
            u.name AS client_name
         FROM orders o
         JOIN tariffs t ON t.id = o.tariff_id
         JOIN users u ON u.id = o.client_id
         WHERE o.status = 'pending'
           AND o.transport_class = ?
         ORDER BY o.created_at ASC
         LIMIT 20",
        [$driver['car_class']]
    );

    Response::ok($orders);
}

Response::notFound("Drivers: неизвестный маршрут '$action'");
