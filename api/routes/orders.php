<?php
// ============================================================
// routes/orders.php — Управление заказами + push-уведомления
// ============================================================
// GET    /api/orders           — список заказов текущего юзера
// POST   /api/orders           — создать заказ
// GET    /api/orders/:id       — детали заказа
// PATCH  /api/orders/:id       — обновить статус (водитель/адм.)
// DELETE /api/orders/:id       — отмена
// POST   /api/orders/:id/rate  — оставить оценку
// GET    /api/orders/active    — активный заказ

$user = Auth::require();

// ── GET /api/orders/active ───────────────────────────────────
if ($method === 'GET' && $subaction === 'active') {
    if ($user['role'] === 'driver') {
        $where = "o.driver_id = ? AND o.status IN ('accepted','arriving','in_progress')";
    } else {
        $where = "o.client_id = ? AND o.status IN ('pending','accepted','arriving','in_progress')";
    }

    $order = Database::row(
        "SELECT o.*, 
            t.name AS tariff_name, t.icon AS tariff_icon,
            u_client.name  AS client_name,  u_client.phone  AS client_phone,
            u_driver.name  AS driver_name,  u_driver.phone  AS driver_phone,
            d.car_make, d.car_model, d.car_number, d.car_color, d.rating AS driver_rating,
            d.current_lat AS driver_lat, d.current_lng AS driver_lng
         FROM orders o
         LEFT JOIN tariffs t ON t.id = o.tariff_id
         JOIN users u_client ON u_client.id = o.client_id
         LEFT JOIN users u_driver ON u_driver.id = o.driver_id
         LEFT JOIN drivers d ON d.user_id = o.driver_id
         WHERE $where
         ORDER BY o.created_at DESC LIMIT 1",
        [$user['id']]
    );

    if ($order) {
        $order['stops'] = Database::query(
            'SELECT * FROM order_stops WHERE order_id=? ORDER BY sort_order',
            [$order['id']]
        );
    }
    Response::ok($order);
}

// ── GET /api/orders ──────────────────────────────────────────
if ($method === 'GET' && !$id) {
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $limit  = 20;
    $offset = ($page - 1) * $limit;

    if ($user['role'] === 'admin') {
        $where = '1=1'; $params = [];
    } elseif ($user['role'] === 'driver') {
        $where = 'o.driver_id = ?'; $params = [$user['id']];
    } else {
        $where = 'o.client_id = ?'; $params = [$user['id']];
    }
    $status = $_GET['status'] ?? '';
    if ($status) { $where .= ' AND o.status = ?'; $params[] = $status; }

    $total  = (int) Database::scalar("SELECT COUNT(*) FROM orders o WHERE $where", $params);
    $orders = Database::query(
        "SELECT o.id, o.status, o.price, o.payment_method, o.transport_class,
            o.from_address, o.to_address, o.distance_km, o.created_at,
            t.name AS tariff_name, t.icon AS tariff_icon,
            u_client.name AS client_name,
            u_driver.name AS driver_name,
            d.car_make, d.car_model, d.car_number
         FROM orders o
         LEFT JOIN tariffs t ON t.id = o.tariff_id
         JOIN users u_client ON u_client.id = o.client_id
         LEFT JOIN users u_driver ON u_driver.id = o.driver_id
         LEFT JOIN drivers d ON d.user_id = o.driver_id
         WHERE $where
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?",
        array_merge($params, [$limit, $offset])
    );
    Response::ok(['orders' => $orders, 'total' => $total, 'page' => $page, 'pages' => (int)ceil($total / $limit)]);
}

// ── POST /api/orders — создать заказ ────────────────────────
if ($method === 'POST' && !$id) {
    if ($user['role'] === 'driver') Response::forbidden('Водители не могут создавать заказы');

    $required = ['tariff_id','from_address','from_lat','from_lng','to_address','to_lat','to_lng','price'];
    $errors   = [];
    foreach ($required as $f) {
        if (empty($body[$f]) && $body[$f] !== '0' && $body[$f] !== 0) $errors[] = "Поле '$f' обязательно";
    }
    if ($errors) Response::error('Ошибка валидации', 422, $errors);

    $active = Database::row(
        "SELECT id FROM orders WHERE client_id=? AND status IN ('pending','accepted','arriving','in_progress') LIMIT 1",
        [$user['id']]
    );
    if ($active) Response::error('У вас уже есть активный заказ #' . $active['id'], 409);

    $orderId = Database::transaction(function() use ($body, $user) {
        $orderId = Database::insert(
            'INSERT INTO orders
             (client_id, tariff_id, transport_class, from_address, from_lat, from_lng,
              to_address, to_lat, to_lng, distance_km, duration_min, price,
              payment_method, options, comment, preferred_driver_id, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $user['id'], (int)$body['tariff_id'],
                $body['transport_class'] ?? 'comfort',
                $body['from_address'], (float)$body['from_lat'], (float)$body['from_lng'],
                $body['to_address'],   (float)$body['to_lat'],   (float)$body['to_lng'],
                isset($body['distance_km'])  ? (float)$body['distance_km']  : null,
                isset($body['duration_min']) ? (int)$body['duration_min']   : null,
                (int)$body['price'],
                $body['payment_method'] ?? 'cash',
                isset($body['options']) ? json_encode($body['options']) : null,
                $body['comment'] ?? null,
                isset($body['preferred_driver_id']) ? (int)$body['preferred_driver_id'] : null,
                'pending',
            ]
        );
        if (!empty($body['stops']) && is_array($body['stops'])) {
            foreach (array_slice($body['stops'], 0, 3) as $i => $stop) {
                Database::insert(
                    'INSERT INTO order_stops (order_id, address, lat, lng, sort_order) VALUES (?,?,?,?,?)',
                    [$orderId, $stop['address'], (float)$stop['lat'], (float)$stop['lng'], $i]
                );
            }
        }
        return $orderId;
    });

    $price = (int)$body['price'];
    $from  = $body['from_address'];
    $to    = $body['to_address'];
    $dist  = isset($body['distance_km']) ? round((float)$body['distance_km'], 1) . ' км' : '';

    // ── PUSH: клиент — ищем водителя ────────────────────────
    WebPush::notify(
        $user['id'],
        'order_searching',
        '🔍 Ищем водителя...',
        "Заказ #{$orderId}: {$from} → {$to}",
        ['order_id' => $orderId],
        '/'
    );

    // ── PUSH: все онлайн-водители — новый заказ ──────────────
    WebPush::sendToOnlineDrivers([
        'title'  => "🔔 Новый заказ! {$price} ₸",
        'body'   => "{$from} → {$to}" . ($dist ? " · {$dist}" : ''),
        'icon'   => '/assets/icons/icon-192.png',
        'badge'  => '/assets/icons/icon-192.png',
        'url'    => '/driver.html',
        'type'   => 'new_order',
        'data'   => ['order_id' => $orderId, 'price' => $price],
    ], 300); // TTL 5 мин — заказ актуален только 5 минут

    // ── PUSH: администраторам — новый заказ ─────────────────
    WebPush::notifyAdmins(
        'new_order',
        "📋 Заказ #{$orderId}",
        "{$price} ₸ · {$from} → {$to}",
        ['order_id' => $orderId, 'price' => $price],
        '/admin.html'
    );

    Response::ok(['order_id' => $orderId], 'Заказ создан', 201);
}

// ── GET /api/orders/:id ──────────────────────────────────────
if ($method === 'GET' && $id) {
    $order = Database::row(
        "SELECT o.*,
            t.name AS tariff_name, t.icon AS tariff_icon,
            u_client.name  AS client_name,  u_client.phone  AS client_phone,
            u_driver.name  AS driver_name,  u_driver.phone  AS driver_phone,
            d.car_make, d.car_model, d.car_number, d.car_color,
            d.current_lat AS driver_lat, d.current_lng AS driver_lng,
            d.rating AS driver_rating
         FROM orders o
         LEFT JOIN tariffs t ON t.id = o.tariff_id
         JOIN users u_client ON u_client.id = o.client_id
         LEFT JOIN users u_driver ON u_driver.id = o.driver_id
         LEFT JOIN drivers d ON d.user_id = o.driver_id
         WHERE o.id = ?",
        [$id]
    );
    if (!$order) Response::notFound('Заказ не найден');
    if ($user['role'] !== 'admin' && $order['client_id'] != $user['id'] && $order['driver_id'] != $user['id']) {
        Response::forbidden();
    }
    $order['stops']   = Database::query('SELECT * FROM order_stops WHERE order_id=? ORDER BY sort_order', [$id]);
    $order['ratings'] = Database::query('SELECT r.*, u.name FROM order_ratings r JOIN users u ON u.id=r.rated_by WHERE r.order_id=?', [$id]);
    Response::ok($order);
}

// ── PATCH /api/orders/:id — смена статуса ───────────────────
if ($method === 'PATCH' && $id) {
    $order     = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound('Заказ не найден');
    $newStatus = $body['status'] ?? '';

    $transitions = [
        'pending'     => ['accepted', 'cancelled'],
        'accepted'    => ['arriving', 'cancelled'],
        'arriving'    => ['in_progress', 'cancelled'],
        'in_progress' => ['completed', 'cancelled'],
        'completed'   => [],
        'cancelled'   => [],
    ];
    $allowed = $transitions[$order['status']] ?? [];
    if (!in_array($newStatus, $allowed)) {
        Response::error("Переход {$order['status']} → {$newStatus} недопустим", 422);
    }

    $updates = ['status = ?'];
    $params  = [$newStatus];
    $canChange = false;

    if ($user['role'] === 'admin') $canChange = true;
    if ($user['role'] === 'driver' && in_array($newStatus, ['accepted','arriving','in_progress','cancelled','completed'])) {
        if ($newStatus === 'accepted' && !$order['driver_id']) {
            $updates[] = 'driver_id = ?';
            $params[]  = $user['id'];
            $canChange = true;
        } elseif ($order['driver_id'] == $user['id']) {
            $canChange = true;
        }
    }
    if ($user['role'] === 'client' && $newStatus === 'cancelled' && $order['client_id'] == $user['id']) {
        $canChange = true;
    }
    if (!$canChange) Response::forbidden('Нет прав для изменения статуса');

    match($newStatus) {
        'in_progress' => $updates[] = 'started_at = NOW()',
        'completed'   => $updates[] = 'completed_at = NOW()',
        'arriving'    => $updates[] = 'arrived_at = NOW()',
        default       => null,
    };

    if ($newStatus === 'cancelled') {
        $updates[] = 'cancelled_by = ?';
        $updates[] = 'cancel_reason = ?';
        $params[]  = $user['role'];
        $params[]  = $body['reason'] ?? null;
    }
    $params[] = $id;
    Database::exec('UPDATE orders SET ' . implode(', ', $updates) . ' WHERE id=?', $params);

    // Загружаем дополнительные данные для уведомлений
    $fullOrder = Database::row(
        "SELECT o.*, 
            u_client.id AS c_id, u_client.name AS c_name,
            u_driver.id AS d_id, u_driver.name AS d_name, u_driver.phone AS d_phone,
            d.car_make, d.car_model, d.car_number, d.car_color
         FROM orders o
         JOIN users u_client ON u_client.id = o.client_id
         LEFT JOIN users u_driver ON u_driver.id = o.driver_id
         LEFT JOIN drivers d ON d.user_id = o.driver_id
         WHERE o.id = ?",
        [$id]
    );

    $clientId = (int)($fullOrder['client_id'] ?? $order['client_id']);
    $driverId = (int)($fullOrder['driver_id'] ?? ($newStatus === 'accepted' ? $user['id'] : $order['driver_id']));
    $price    = (int)$order['price'];
    $from     = $order['from_address'];
    $to       = $order['to_address'];
    $carName  = trim(($fullOrder['car_make'] ?? '') . ' ' . ($fullOrder['car_model'] ?? ''));
    $carNum   = $fullOrder['car_number'] ?? '';
    $carColor = $fullOrder['car_color']  ?? '';
    $dName    = $fullOrder['d_name']     ?? 'Водитель';

    // ──────────────────────────────────────────────────────────
    // PUSH-уведомления по каждому переходу статуса
    // ──────────────────────────────────────────────────────────

    switch ($newStatus) {

        // ── Водитель принял заказ ────────────────────────────
        case 'accepted':
            // Клиенту
            WebPush::notify(
                $clientId,
                'order_accepted',
                '🚗 Водитель найден!',
                "{$dName} едет к вам" . ($carName ? " · {$carName}" . ($carNum ? " ({$carNum})" : '') : ''),
                ['order_id' => $id, 'driver_name' => $dName, 'car' => $carName, 'car_number' => $carNum],
                '/'
            );
            // Администраторам
            WebPush::notifyAdmins(
                'order_accepted',
                "✅ Заказ #{$id} принят",
                "{$dName} взял заказ {$from} → {$to}",
                ['order_id' => $id],
                '/admin.html'
            );
            break;

        // ── Водитель подъезжает ──────────────────────────────
        case 'arriving':
            WebPush::notify(
                $clientId,
                'driver_arriving',
                '📍 Водитель подъезжает!',
                ($carColor ? ucfirst($carColor) . ' ' : '') . ($carName ?: 'Автомобиль') . ' · ' . ($carNum ?: 'скоро будет'),
                ['order_id' => $id, 'car_color' => $carColor, 'car' => $carName],
                '/'
            );
            break;

        // ── Поездка началась ─────────────────────────────────
        case 'in_progress':
            WebPush::notify(
                $clientId,
                'trip_started',
                '🚀 Поездка началась!',
                "Едем в {$to}. Приятного пути!",
                ['order_id' => $id],
                '/'
            );
            // Водителю — напоминание
            if ($driverId) {
                WebPush::notify(
                    $driverId,
                    'trip_started',
                    '▶️ Поездка начата',
                    "Везём пассажира в {$to}",
                    ['order_id' => $id],
                    '/driver.html'
                );
            }
            break;

        // ── Поездка завершена ────────────────────────────────
        case 'completed':
            // Клиенту — предложение оценить
            WebPush::notify(
                $clientId,
                'trip_completed',
                '✅ Поездка завершена!',
                "Стоимость: {$price} ₸. Оцените поездку — это займёт 5 секунд ⭐",
                ['order_id' => $id, 'price' => $price],
                '/'
            );
            // Водителю — заработок
            if ($driverId) {
                WebPush::notify(
                    $driverId,
                    'trip_completed',
                    '💰 Поездка завершена!',
                    "Заработано: {$price} ₸ · {$from} → {$to}",
                    ['order_id' => $id, 'price' => $price],
                    '/driver.html'
                );
            }
            // Администраторам
            WebPush::notifyAdmins(
                'order_completed',
                "✅ Заказ #{$id} выполнен",
                "{$price} ₸ · {$from} → {$to}",
                ['order_id' => $id, 'price' => $price],
                '/admin.html'
            );
            break;

        // ── Отмена заказа ────────────────────────────────────
        case 'cancelled':
            $cancelBy     = $user['role'];
            $cancelReason = $body['reason'] ?? null;

            if ($cancelBy === 'driver') {
                // Клиенту: водитель отменил
                WebPush::notify(
                    $clientId,
                    'order_cancelled_driver',
                    '❌ Водитель отменил заказ',
                    'Не переживайте — ищем нового водителя...',
                    ['order_id' => $id, 'reason' => $cancelReason],
                    '/'
                );
            } elseif ($cancelBy === 'client') {
                // Водителю: пассажир отменил
                if ($driverId) {
                    WebPush::notify(
                        $driverId,
                        'order_cancelled_client',
                        '❌ Пассажир отменил заказ',
                        "Заказ #{$id} отменён пассажиром" . ($cancelReason ? " · {$cancelReason}" : ''),
                        ['order_id' => $id, 'reason' => $cancelReason],
                        '/driver.html'
                    );
                }
            }
            // Администраторам
            $byText = match($cancelBy) { 'driver' => 'водителем', 'client' => 'пассажиром', default => 'администратором' };
            WebPush::notifyAdmins(
                'order_cancelled',
                "❌ Заказ #{$id} отменён",
                "Отменён {$byText}" . ($cancelReason ? " · {$cancelReason}" : ''),
                ['order_id' => $id, 'cancelled_by' => $cancelBy, 'reason' => $cancelReason],
                '/admin.html'
            );
            break;
    }

    Response::ok(['status' => $newStatus], 'Статус обновлён');
}

// ── DELETE /api/orders/:id — отмена клиентом ────────────────
if ($method === 'DELETE' && $id) {
    $order = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound();
    if ($order['client_id'] != $user['id'] && $user['role'] !== 'admin') Response::forbidden();
    if (!in_array($order['status'], ['pending','accepted'])) {
        Response::error('Нельзя отменить заказ в статусе ' . $order['status']);
    }
    $reason = $body['reason'] ?? 'Отменён клиентом';
    Database::exec(
        "UPDATE orders SET status='cancelled', cancelled_by=?, cancel_reason=? WHERE id=?",
        [$user['role'], $reason, $id]
    );

    // Водителю: клиент отменил
    if ($order['driver_id']) {
        WebPush::notify(
            (int)$order['driver_id'],
            'order_cancelled_client',
            '❌ Пассажир отменил заказ',
            "Заказ #{$id} отменён пассажиром",
            ['order_id' => $id],
            '/driver.html'
        );
    }
    // Администраторам
    WebPush::notifyAdmins(
        'order_cancelled',
        "❌ Заказ #{$id} отменён",
        "Отменён пассажиром · {$reason}",
        ['order_id' => $id],
        '/admin.html'
    );

    Response::ok(null, 'Заказ отменён');
}

// ── POST /api/orders/:id/rate — оценка ──────────────────────
if ($method === 'POST' && $id && $subaction === 'rate') {
    $order = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound();
    if ($order['status'] !== 'completed') Response::error('Оценить можно только завершённый заказ');

    $rating  = (int)($body['rating']  ?? 0);
    $comment = $body['comment'] ?? null;
    if ($rating < 1 || $rating > 5) Response::error('Оценка от 1 до 5');

    $ratedUser = $user['role'] === 'client' ? $order['driver_id'] : $order['client_id'];
    if (!$ratedUser) Response::error('Нет пользователя для оценки');

    $exists = Database::row('SELECT id FROM order_ratings WHERE order_id=? AND rated_by=?', [$id, $user['id']]);
    if ($exists) Response::error('Вы уже оценили этот заказ');

    Database::insert(
        'INSERT INTO order_ratings (order_id, rated_by, rated_user, rating, comment) VALUES (?,?,?,?,?)',
        [$id, $user['id'], $ratedUser, $rating, $comment]
    );

    if ($user['role'] === 'client') {
        Database::exec(
            'UPDATE drivers SET rating = (SELECT AVG(rating) FROM order_ratings WHERE rated_user=?) WHERE user_id=?',
            [$ratedUser, $ratedUser]
        );
        // Новый рейтинг
        $newRating = round((float)Database::scalar(
            'SELECT rating FROM drivers WHERE user_id=?', [$ratedUser]
        ), 2);

        // ── PUSH водителю — получена оценка ─────────────────
        $stars  = str_repeat('⭐', $rating);
        $text   = $comment ? " · «{$comment}»" : '';
        WebPush::notify(
            (int)$ratedUser,
            'rating_received',
            "{$stars} Новая оценка: {$rating}/5",
            "Пассажир оценил поездку{$text}" . ($newRating ? " · Ваш рейтинг: {$newRating}" : ''),
            ['order_id' => $id, 'rating' => $rating, 'new_avg' => $newRating],
            '/driver.html'
        );

        // Если рейтинг сильно упал — предупредить администратора
        if ($newRating > 0 && $newRating < 4.0) {
            $driverUser = Database::row(
                'SELECT u.name, u.phone FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.user_id=?',
                [$ratedUser]
            );
            WebPush::notifyAdmins(
                'low_rating_driver',
                "⚠️ Низкий рейтинг водителя",
                ($driverUser['name'] ?? $driverUser['phone'] ?? 'Водитель') . " — рейтинг {$newRating}",
                ['driver_user_id' => $ratedUser, 'rating' => $newRating],
                '/admin.html'
            );
        }
    } else {
        // Клиенту — водитель оценил его
        WebPush::notify(
            (int)$ratedUser,
            'rating_received',
            str_repeat('⭐', $rating) . " Водитель оценил вас!",
            "Оценка за поездку: {$rating}/5" . ($comment ? " · «{$comment}»" : ''),
            ['order_id' => $id, 'rating' => $rating],
            '/'
        );
    }

    Response::ok(['rating' => $rating], 'Спасибо за оценку!');
}

Response::notFound('Orders: неизвестный маршрут');