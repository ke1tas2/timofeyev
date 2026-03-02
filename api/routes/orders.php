<?php
// ============================================================
// routes/orders.php — Управление заказами
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
    $where = $user['role'] === 'driver'
        ? 'driver_id = ? AND status IN ("accepted","arriving","in_progress")'
        : 'client_id = ? AND status IN ("pending","accepted","arriving","in_progress")';

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
         WHERE o.$where
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
    $page  = max(1, (int)($_GET['page'] ?? 1));
    $limit = 20;
    $offset = ($page - 1) * $limit;

    if ($user['role'] === 'admin') {
        $where = '1=1';
        $params = [];
    } elseif ($user['role'] === 'driver') {
        $where = 'o.driver_id = ?';
        $params = [$user['id']];
    } else {
        $where = 'o.client_id = ?';
        $params = [$user['id']];
    }

    // Фильтр по статусу
    $status = $_GET['status'] ?? '';
    if ($status) {
        $where .= ' AND o.status = ?';
        $params[] = $status;
    }

    $total = (int) Database::scalar("SELECT COUNT(*) FROM orders o WHERE $where", $params);

    $paramsPage = array_merge($params, [$limit, $offset]);
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
        $paramsPage
    );

    Response::ok([
        'orders' => $orders,
        'total'  => $total,
        'page'   => $page,
        'pages'  => (int) ceil($total / $limit),
    ]);
}

// ── POST /api/orders — создать заказ ────────────────────────
if ($method === 'POST' && !$id) {
    if ($user['role'] === 'driver') Response::forbidden('Водители не могут создавать заказы');

    // Валидация
    $required = ['tariff_id','from_address','from_lat','from_lng','to_address','to_lat','to_lng','price'];
    $errors = [];
    foreach ($required as $f) {
        if (empty($body[$f]) && $body[$f] !== '0' && $body[$f] !== 0) {
            $errors[] = "Поле '$f' обязательно";
        }
    }
    if ($errors) Response::error('Ошибка валидации', 422, $errors);

    // Проверяем, нет ли активного заказа
    $active = Database::row(
        "SELECT id FROM orders WHERE client_id=? AND status IN ('pending','accepted','arriving','in_progress') LIMIT 1",
        [$user['id']]
    );
    if ($active) {
        Response::error('У вас уже есть активный заказ #' . $active['id'], 409);
    }

    $orderId = Database::transaction(function() use ($body, $user) {
        $orderId = Database::insert(
            'INSERT INTO orders
             (client_id, tariff_id, transport_class, from_address, from_lat, from_lng,
              to_address, to_lat, to_lng, distance_km, duration_min, price,
              payment_method, options, comment, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $user['id'],
                (int)$body['tariff_id'],
                $body['transport_class'] ?? 'comfort',
                $body['from_address'],
                (float)$body['from_lat'],
                (float)$body['from_lng'],
                $body['to_address'],
                (float)$body['to_lat'],
                (float)$body['to_lng'],
                isset($body['distance_km'])  ? (float)$body['distance_km']  : null,
                isset($body['duration_min']) ? (int)$body['duration_min']   : null,
                (int)$body['price'],
                $body['payment_method'] ?? 'cash',
                isset($body['options']) ? json_encode($body['options']) : null,
                $body['comment'] ?? null,
                'pending',
            ]
        );

        // Промежуточные остановки
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

    // TODO: уведомить доступных водителей (push / websocket / polling)

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

    // Права доступа
    if ($user['role'] !== 'admin'
        && $order['client_id'] != $user['id']
        && $order['driver_id'] != $user['id']) {
        Response::forbidden();
    }

    $order['stops'] = Database::query(
        'SELECT * FROM order_stops WHERE order_id=? ORDER BY sort_order',
        [$id]
    );
    $order['ratings'] = Database::query(
        'SELECT r.*, u.name FROM order_ratings r JOIN users u ON u.id=r.rated_by WHERE r.order_id=?',
        [$id]
    );

    Response::ok($order);
}

// ── PATCH /api/orders/:id — смена статуса ───────────────────
if ($method === 'PATCH' && $id) {
    $order = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound('Заказ не найден');

    $newStatus = $body['status'] ?? '';

    // Матрица переходов
    $transitions = [
        'pending'     => ['accepted', 'cancelled'],
        'accepted'    => ['arriving', 'cancelled'],
        'arriving'    => ['in_progress', 'cancelled'],
        'in_progress' => ['completed'],
        'completed'   => [],
        'cancelled'   => [],
    ];

    $allowed = $transitions[$order['status']] ?? [];
    if (!in_array($newStatus, $allowed)) {
        Response::error("Переход $order[status] → $newStatus недопустим", 422);
    }

    // Права
    $canChange = false;
    if ($user['role'] === 'admin') $canChange = true;
    if ($user['role'] === 'driver' && in_array($newStatus, ['accepted','arriving','in_progress','cancelled','completed'])) {
        if ($newStatus === 'accepted' && !$order['driver_id']) {
            // Атомарно: driver_id + status в одном UPDATE
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

    $updates = ['status = ?'];
    $params  = [$newStatus];

    // Временные метки
    match($newStatus) {
        'in_progress' => [$updates[] = 'started_at = NOW()'],
        'completed'   => [$updates[] = 'completed_at = NOW()'],
        'arriving'    => [$updates[] = 'arrived_at = NOW()'],
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

    Response::ok(['status' => $newStatus], 'Статус обновлён');
}

// ── DELETE /api/orders/:id — отмена ─────────────────────────
if ($method === 'DELETE' && $id) {
    $order = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound();
    if ($order['client_id'] != $user['id'] && $user['role'] !== 'admin') Response::forbidden();
    if (!in_array($order['status'], ['pending','accepted'])) {
        Response::error('Нельзя отменить заказ в статусе ' . $order['status']);
    }
    Database::exec(
        "UPDATE orders SET status='cancelled', cancelled_by=?, cancel_reason=? WHERE id=?",
        [$user['role'], $body['reason'] ?? 'Отменён клиентом', $id]
    );
    Response::ok(null, 'Заказ отменён');
}

// ── POST /api/orders/:id/rate — оценка ──────────────────────
if ($method === 'POST' && $id && $subaction === 'rate') {
    $order = Database::row('SELECT * FROM orders WHERE id=?', [$id]);
    if (!$order) Response::notFound();
    if ($order['status'] !== 'completed') Response::error('Оценить можно только завершённый заказ');

    $rating  = (int)($body['rating'] ?? 0);
    $comment = $body['comment'] ?? null;

    if ($rating < 1 || $rating > 5) Response::error('Оценка от 1 до 5');

    // Кого оцениваем
    $ratedUser = $user['role'] === 'client' ? $order['driver_id'] : $order['client_id'];
    if (!$ratedUser) Response::error('Нет пользователя для оценки');

    // Проверяем дубли
    $exists = Database::row(
        'SELECT id FROM order_ratings WHERE order_id=? AND rated_by=?',
        [$id, $user['id']]
    );
    if ($exists) Response::error('Вы уже оценили этот заказ');

    Database::insert(
        'INSERT INTO order_ratings (order_id, rated_by, rated_user, rating, comment) VALUES (?,?,?,?,?)',
        [$id, $user['id'], $ratedUser, $rating, $comment]
    );

    // Пересчитываем рейтинг водителя
    if ($user['role'] === 'client') {
        Database::exec(
            'UPDATE drivers SET rating = (SELECT AVG(rating) FROM order_ratings WHERE rated_user=?) WHERE user_id=?',
            [$ratedUser, $ratedUser]
        );
    }

    Response::ok(['rating' => $rating], 'Спасибо за оценку!');
}

Response::notFound('Orders: неизвестный маршрут');