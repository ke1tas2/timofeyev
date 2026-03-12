<?php
// ============================================================
// routes/drivers.php — Раздел водителя + push-уведомления
// ============================================================

$user   = Auth::require();
$action = is_numeric($segments[1] ?? '') ? '' : ($segments[1] ?? '');

// ── POST /api/drivers/apply ──────────────────────────────────
if ($method === 'POST' && $action === 'apply') {
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
        Database::exec("UPDATE users SET role='driver' WHERE id=?", [$user['id']]);
    });

    // ── PUSH администраторам — новая заявка водителя ────────
    $phone   = $user['phone'];
    $name    = $user['name'] ? " ({$user['name']})" : '';
    $carInfo = trim(($body['car_make'] ?? '') . ' ' . ($body['car_model'] ?? '') . ' ' . ($body['car_number'] ?? ''));
    WebPush::notifyAdmins(
        'new_driver_application',
        "👤 Новая заявка водителя",
        "Телефон: {$phone}{$name}" . ($carInfo ? " · {$carInfo}" : ''),
        ['user_id' => $user['id'], 'phone' => $phone, 'car' => $carInfo],
        '/admin.html'
    );

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
    Response::ok(array_merge($driver ?? [], ['name' => $user['name'], 'phone' => $user['phone']]));
}

// ── PUT /api/drivers/me ──────────────────────────────────────
if ($method === 'PUT' && $action === 'me') {
    $fields = ['car_make','car_model','car_year','car_color','car_number','car_class','license_number'];
    $sets = []; $params = [];
    foreach ($fields as $f) {
        if (array_key_exists($f, $body)) { $sets[] = "$f = ?"; $params[] = $body[$f]; }
    }
    if ($sets) {
        $params[] = $user['id'];
        Database::exec('UPDATE drivers SET ' . implode(', ', $sets) . ' WHERE user_id=?', $params);
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
    Response::ok(['lat' => (float)$lat, 'lng' => (float)$lng]);
}

// ── PATCH /api/drivers/status — онлайн/оффлайн ──────────────
if ($method === 'PATCH' && $action === 'status') {
    if ($driver['status'] !== 'approved') {
        Response::error('Ваша заявка ещё не одобрена');
    }
    $online = (bool)($body['is_online'] ?? false);
    Database::exec('UPDATE drivers SET is_online=? WHERE user_id=?', [(int)$online, $user['id']]);

    if ($online) {
        // ── PUSH водителю — вышел на линию ──────────────────
        WebPush::notify(
            $user['id'],
            'driver_online',
            '🟢 Вы на линии!',
            'Ожидаем новые заказы для вас. Удачной смены!',
            [],
            '/driver.html'
        );
    } else {
        // ── PUSH водителю — ушёл оффлайн ────────────────────
        WebPush::notify(
            $user['id'],
            'driver_offline',
            '🔴 Вы ушли с линии',
            'Хорошего отдыха! Возвращайтесь скорее.',
            [],
            '/driver.html'
        );
    }

    Response::ok(['is_online' => $online], $online ? 'Вы онлайн' : 'Вы оффлайн');
}

// ── GET /api/drivers/orders — доступные заказы ─────────────
if ($method === 'GET' && $action === 'orders') {
    if ($driver['status'] !== 'approved' || !$driver['is_online']) {
        Response::error('Вы должны быть онлайн и одобренным водителем');
    }
    $orders = Database::query(
        "SELECT o.id, o.from_address, o.to_address, o.price, o.distance_km,
            o.from_lat, o.from_lng, o.to_lat, o.to_lng,
            o.transport_class, o.payment_method, o.created_at,
            t.name AS tariff_name,
            u.name AS client_name
         FROM orders o
         JOIN tariffs t ON t.id = o.tariff_id
         JOIN users u ON u.id = o.client_id
         WHERE o.status = 'pending'
         ORDER BY o.created_at ASC
         LIMIT 20",
        []
    );
    Response::ok($orders);
}

Response::notFound("Drivers: неизвестный маршрут '$action'");