<?php
// ============================================================
// routes/admin.php — Административный раздел + push-уведомления
// ============================================================

$admin = Auth::requireRole('admin');
$sub   = $segments[1] ?? '';
$subId = isset($segments[2]) && is_numeric($segments[2]) ? (int)$segments[2] : null;

// ── GET /api/admin/stats ─────────────────────────────────────
if ($method === 'GET' && $sub === 'stats') {
    $stats = [
        'users_total'     => Database::scalar('SELECT COUNT(*) FROM users'),
        'users_clients'   => Database::scalar("SELECT COUNT(*) FROM users WHERE role='client'"),
        'users_drivers'   => Database::scalar("SELECT COUNT(*) FROM users WHERE role='driver'"),
        'drivers_online'  => Database::scalar('SELECT COUNT(*) FROM drivers WHERE is_online=1'),
        'drivers_pending' => Database::scalar("SELECT COUNT(*) FROM drivers WHERE status='pending'"),

        'orders_total'     => Database::scalar('SELECT COUNT(*) FROM orders'),
        'orders_pending'   => Database::scalar("SELECT COUNT(*) FROM orders WHERE status='pending'"),
        'orders_active'    => Database::scalar("SELECT COUNT(*) FROM orders WHERE status IN ('accepted','arriving','in_progress')"),
        'orders_completed' => Database::scalar("SELECT COUNT(*) FROM orders WHERE status='completed'"),
        'orders_cancelled' => Database::scalar("SELECT COUNT(*) FROM orders WHERE status='cancelled'"),

        'revenue_total'    => Database::scalar("SELECT COALESCE(SUM(price),0) FROM orders WHERE status='completed'"),
        'revenue_today'    => Database::scalar("SELECT COALESCE(SUM(price),0) FROM orders WHERE status='completed' AND DATE(completed_at)=CURDATE()"),
        'revenue_month'    => Database::scalar("SELECT COALESCE(SUM(price),0) FROM orders WHERE status='completed' AND YEAR(completed_at)=YEAR(NOW()) AND MONTH(completed_at)=MONTH(NOW())"),

        'new_users_today'  => Database::scalar("SELECT COUNT(*) FROM users WHERE DATE(created_at)=CURDATE()"),
        'new_orders_today' => Database::scalar("SELECT COUNT(*) FROM orders WHERE DATE(created_at)=CURDATE()"),
    ];
    Response::ok($stats);
}

// ── GET /api/admin/users ─────────────────────────────────────
if ($method === 'GET' && $sub === 'users') {
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $limit  = 30;
    $offset = ($page - 1) * $limit;
    $search = $_GET['search'] ?? '';
    $where  = '1=1'; $params = [];
    if ($search) { $where = 'phone LIKE ? OR name LIKE ?'; $params = ["%$search%", "%$search%"]; }
    if (!empty($_GET['role'])) { $where .= ' AND role = ?'; $params[] = $_GET['role']; }
    $total = (int)Database::scalar("SELECT COUNT(*) FROM users WHERE $where", $params);
    $users = Database::query(
        "SELECT id, phone, name, email, role, status, created_at, last_login_at
         FROM users WHERE $where ORDER BY id DESC LIMIT ? OFFSET ?",
        array_merge($params, [$limit, $offset])
    );
    Response::ok(['users' => $users, 'total' => $total, 'page' => $page]);
}

// ── PATCH /api/admin/users/:id ───────────────────────────────
if ($method === 'PATCH' && $sub === 'users' && $subId) {
    $allowed = ['status' => ['active','blocked'], 'role' => ['client','driver','admin']];
    $sets = []; $params = [];
    foreach ($allowed as $field => $valid) {
        if (isset($body[$field]) && in_array($body[$field], $valid)) {
            $sets[] = "$field = ?"; $params[] = $body[$field];
        }
    }
    if (!$sets) Response::error('Нет допустимых полей');
    $params[] = $subId;
    Database::exec('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id=?', $params);

    // ── PUSH: если пользователя заблокировали ──────────────
    if (isset($body['status']) && $body['status'] === 'blocked') {
        WebPush::notify(
            $subId,
            'account_blocked',
            '⛔ Аккаунт заблокирован',
            'Ваш аккаунт заблокирован администратором. Обратитесь в поддержку.',
            [],
            '/'
        );
    }

    Response::ok(null, 'Пользователь обновлён');
}

// ── GET /api/admin/drivers ───────────────────────────────────
if ($method === 'GET' && $sub === 'drivers') {
    $status = $_GET['status'] ?? '';
    $where  = $status ? 'WHERE d.status = ?' : 'WHERE 1=1';
    $params = $status ? [$status] : [];
    $drivers = Database::query(
        "SELECT d.*, u.name, u.phone, u.status AS user_status
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         $where
         ORDER BY d.created_at DESC",
        $params
    );
    Response::ok($drivers);
}

// ── PATCH /api/admin/drivers/:id — одобрить/отклонить ───────
if ($method === 'PATCH' && $sub === 'drivers' && $subId) {
    $status = $body['status'] ?? '';
    if (!in_array($status, ['approved','rejected','suspended'])) {
        Response::error("Статус '$status' недопустим");
    }
    Database::exec('UPDATE drivers SET status=? WHERE id=?', [$status, $subId]);

    $drv = Database::row(
        'SELECT u.id AS user_id, u.phone, u.name FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=?',
        [$subId]
    );

    if ($drv) {
        switch ($status) {
            case 'approved':
                // SMS
                SMS::send($drv['phone'], 'Ваша заявка в Timofeyev одобрена! Войдите в приложение и начните принимать заказы.');
                // ── PUSH водителю — одобрен ──────────────────
                WebPush::notify(
                    (int)$drv['user_id'],
                    'application_approved',
                    '🎉 Заявка одобрена!',
                    'Добро пожаловать в команду Timofeyev! Выходите на линию и принимайте заказы.',
                    [],
                    '/driver.html'
                );
                break;

            case 'rejected':
                // ── PUSH водителю — отклонён ─────────────────
                WebPush::notify(
                    (int)$drv['user_id'],
                    'application_rejected',
                    '❌ Заявка отклонена',
                    'К сожалению, ваша заявка водителя отклонена. Обратитесь в поддержку для уточнения.',
                    [],
                    '/'
                );
                break;

            case 'suspended':
                // ── PUSH водителю — приостановлен ────────────
                WebPush::notify(
                    (int)$drv['user_id'],
                    'driver_suspended',
                    '⏸ Аккаунт водителя приостановлен',
                    'Ваш доступ к заказам временно приостановлен. Свяжитесь с поддержкой.',
                    [],
                    '/'
                );
                break;
        }
    }

    Response::ok(null, "Статус водителя изменён на '$status'");
}

// ── GET /api/admin/orders ─────────────────────────────────────
if ($method === 'GET' && $sub === 'orders') {
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $limit  = 30;
    $offset = ($page - 1) * $limit;
    $status = $_GET['status'] ?? '';
    $where  = $status ? 'o.status = ?' : '1=1';
    $params = $status ? [$status] : [];
    $total  = (int)Database::scalar("SELECT COUNT(*) FROM orders o WHERE $where", $params);
    $orders = Database::query(
        "SELECT o.id, o.status, o.price, o.transport_class, o.payment_method,
            o.from_address, o.to_address, o.distance_km, o.created_at,
            t.name AS tariff_name,
            uc.name AS client_name, uc.phone AS client_phone,
            ud.name AS driver_name, ud.phone AS driver_phone
         FROM orders o
         LEFT JOIN tariffs t ON t.id = o.tariff_id
         JOIN users uc ON uc.id = o.client_id
         LEFT JOIN users ud ON ud.id = o.driver_id
         WHERE $where
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?",
        array_merge($params, [$limit, $offset])
    );
    Response::ok(['orders' => $orders, 'total' => $total, 'page' => $page]);
}

// ── GET /api/admin/promo ──────────────────────────────────────
if ($method === 'GET' && $sub === 'promo') {
    Response::ok(Database::query('SELECT * FROM promo_codes ORDER BY id DESC'));
}

// ── POST /api/admin/promo — создать промокод ─────────────────
if ($method === 'POST' && $sub === 'promo') {
    $code  = strtoupper(trim($body['code'] ?? ''));
    $type  = $body['discount_type']  ?? 'fixed';
    $value = (int)($body['discount_value'] ?? 0);
    if (!$code || !$value) Response::error('Введите код и значение скидки');
    if (!in_array($type, ['percent','fixed'])) Response::error('Тип скидки: percent или fixed');
    $id = Database::insert(
        'INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, valid_from, valid_to) VALUES (?,?,?,?,?,?)',
        [$code, $type, $value, $body['max_uses'] ?? null, $body['valid_from'] ?? null, $body['valid_to'] ?? null]
    );
    Response::ok(['id' => $id, 'code' => $code], 'Промокод создан', 201);
}

// ── POST /api/admin/push-broadcast — рассылка push всем ──────
// Полезно для акций и объявлений
if ($method === 'POST' && $sub === 'push-broadcast') {
    $title  = trim($body['title'] ?? '');
    $msg    = trim($body['body']  ?? '');
    $target = $body['target'] ?? 'all'; // 'all' | 'clients' | 'drivers'
    $url    = $body['url'] ?? '/';

    if (!$title || !$msg) Response::error('Укажите title и body');

    $whereRole = match($target) {
        'clients' => "AND u.role = 'client'",
        'drivers' => "AND u.role = 'driver'",
        default   => '',
    };

    $subs = Database::query(
        "SELECT ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN users u ON u.id = ps.user_id
         WHERE u.status = 'active' $whereRole"
    );

    $sent = 0;
    foreach ($subs as $s) {
        $ok = WebPush::send([
            'endpoint' => $s['endpoint'],
            'keys'     => ['p256dh' => $s['p256dh'], 'auth' => $s['auth']],
        ], [
            'title'  => $title,
            'body'   => $msg,
            'icon'   => '/assets/icons/icon-192.png',
            'badge'  => '/assets/icons/icon-192.png',
            'url'    => $url,
            'type'   => 'broadcast',
        ]);
        if ($ok) $sent++;
    }

    Response::ok(['sent' => $sent, 'total' => count($subs)], "Отправлено {$sent} из " . count($subs));
}

Response::notFound("Admin: неизвестный маршрут '$sub'");