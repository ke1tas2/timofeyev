<?php
// ============================================================
// routes/auth.php — Авторизация по номеру телефона + OTP
// ============================================================
// POST /api/auth/send-otp     — отправить OTP на телефон
// POST /api/auth/verify-otp   — проверить OTP → токен
// POST /api/auth/logout        — инвалидировать токен
// GET  /api/auth/me            — текущий пользователь
// PUT  /api/auth/me            — обновить профиль

// Вспомогательные функции
function normalizePhone(string $raw): ?string {
    $digits = preg_replace('/\D/', '', $raw);
    // Казахстан/Россия: 10 цифр без кода → добавляем +7
    if (strlen($digits) === 10) return '+7' . $digits;
    // С кодом страны: 11 цифр начиная с 7 или 8
    if (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')) {
        return '+7' . substr($digits, 1);
    }
    // С плюсом
    if (strlen($digits) === 11 || strlen($digits) === 12) return '+' . $digits;
    return null;
}

function generateOtp(int $length = 6): string {
    return str_pad((string)random_int(0, (10 ** $length) - 1), $length, '0', STR_PAD_LEFT);
}

// ── Разбор под-маршрутов ───────────────────────────────────
$action = $subaction ?: ($segments[1] ?? '');

// GET /api/auth/me
if ($method === 'GET' && $action === 'me') {
    $user = Auth::require();

    // Дополнительные данные водителя — возвращаем всегда, даже если роль сейчас 'client'
    // (водитель мог временно переключиться в режим пассажира, ему нужно знать свой статус)
    $driverData = Database::row('SELECT * FROM drivers WHERE user_id = ?', [$user['id']]);

    Response::ok([
        'id'       => $user['id'],
        'phone'    => $user['phone'],
        'name'     => $user['name'],
        'email'    => $user['email'] ?? null,
        'avatar'   => $user['avatar'] ?? null,
        'role'     => $user['role'],
        'is_admin' => !empty($user['is_admin']),
        'driver'   => $driverData,
    ]);
}

// PUT /api/auth/me — обновление профиля
if ($method === 'PUT' && $action === 'me') {
    $user = Auth::require();
    $name  = trim($body['name'] ?? '');
    $email = trim($body['email'] ?? '');

    if ($name !== '') {
        Database::exec('UPDATE users SET name=?, email=? WHERE id=?', [$name ?: null, $email ?: null, $user['id']]);
    }
    Response::ok(null, 'Профиль обновлён');
}

// POST /api/auth/send-otp
if ($method === 'POST' && $action === 'send-otp') {
    $rawPhone = $body['phone'] ?? '';
    $phone = normalizePhone($rawPhone);

    if (!$phone) {
        Response::error('Неверный формат телефона');
    }

    // Проверяем повторную отправку (антифлуд)
    $lastOtp = Database::row(
        'SELECT created_at FROM otp_codes WHERE phone=? ORDER BY id DESC LIMIT 1',
        [$phone]
    );
    if ($lastOtp) {
        $delay = $config['otp']['resend_delay'];
        $since = time() - strtotime($lastOtp['created_at']);
        if ($since < $delay) {
            Response::error("Повторная отправка через " . ($delay - $since) . " сек.", 429);
        }
    }

    // В режиме mock — всегда 123456
    $code = ($config['sms']['provider'] === 'mock') ? '123456' : generateOtp($config['otp']['length']);
    $expires = date('Y-m-d H:i:s', time() + $config['otp']['ttl']);

    $sent = SMS::send($phone, "Ваш код Timofeyev: $code. Не сообщайте его никому.");

    if (!$sent) {
        Response::error('Не удалось отправить SMS. Попробуйте позже.', 503);
    }

    Database::insert(
        'INSERT INTO otp_codes (phone, code, expires_at) VALUES (?,?,?)',
        [$phone, $code, $expires]
    );

    

    Response::ok([
        'phone'     => $phone,
        'expires_in'=> $config['otp']['ttl'],
    ], 'Код отправлен');
}

// POST /api/auth/verify-otp
if ($method === 'POST' && $action === 'verify-otp') {
    $rawPhone = $body['phone'] ?? '';
    $code     = trim($body['code'] ?? '');
    $phone    = normalizePhone($rawPhone);

    if (!$phone || strlen($code) < 4) {
        Response::error('Укажите телефон и код');
    }

    // Находим актуальный OTP
    $otp = Database::row(
        'SELECT * FROM otp_codes 
         WHERE phone=? AND used=0 AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1',
        [$phone]
    );

    if (!$otp) {
        Response::error('Код недействителен или истёк. Запросите новый.');
    }

    // Проверяем кол-во попыток
    if ($otp['attempts'] >= $config['otp']['max_attempts']) {
        Database::exec('UPDATE otp_codes SET used=1 WHERE id=?', [$otp['id']]);
        Response::error('Превышено количество попыток. Запросите новый код.', 429);
    }

    if ($otp['code'] !== $code) {
        Database::exec('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?', [$otp['id']]);
        $left = $config['otp']['max_attempts'] - $otp['attempts'] - 1;
        Response::error("Неверный код. Осталось попыток: $left");
    }

    // Код верный — помечаем использованным
    Database::exec('UPDATE otp_codes SET used=1 WHERE id=?', [$otp['id']]);

    // Получаем или создаём пользователя
    // INSERT IGNORE защищает от дублей даже при одновременных запросах
    $isNew = false;
    $user  = Database::row('SELECT * FROM users WHERE phone=?', [$phone]);

    if (!$user) {
        // Атомарная вставка — если другой запрос успел вставить раньше, молча игнорируем
        Database::exec(
            'INSERT IGNORE INTO users (phone, role, status) VALUES (?,?,?)',
            [$phone, 'client', 'active']
        );
        // Читаем запись — либо только что созданную, либо уже существующую
        $user = Database::row('SELECT * FROM users WHERE phone=?', [$phone]);
        if ($user && is_null($user['name'])) {
            $isNew = true;
        }
    }

    if ($user['status'] !== 'active') {
        Response::error('Ваш аккаунт заблокирован. Обратитесь в поддержку.', 403);
    }

    // Генерируем JWT
    $payload = [
        'user_id' => $user['id'],
        'phone'   => $user['phone'],
        'role'    => $user['role'],
    ];
    $token     = JWT::encode($payload, $config['jwt']['expires']);
    $tokenHash = JWT::hash($token);
    $expiresAt = date('Y-m-d H:i:s', time() + $config['jwt']['expires']);

    // Сохраняем в БД
    Database::insert(
        'INSERT INTO auth_tokens (user_id, token_hash, device_info, ip, expires_at)
         VALUES (?,?,?,?,?)',
        [
            $user['id'],
            $tokenHash,
            $_SERVER['HTTP_USER_AGENT'] ?? null,
            $_SERVER['REMOTE_ADDR'] ?? null,
            $expiresAt,
        ]
    );

    // Обновляем last_login
    Database::exec('UPDATE users SET last_login_at=NOW() WHERE id=?', [$user['id']]);

    Response::ok([
        'token'  => $token,
        'is_new' => $isNew,
        'user'   => [
            'id'    => $user['id'],
            'phone' => $user['phone'],
            'name'  => $user['name'],
            'role'  => $user['role'],
        ],
    ], $isNew ? 'Регистрация прошла успешно' : 'Вход выполнен');
}

// POST /api/auth/logout
if ($method === 'POST' && $action === 'logout') {
    $user = Auth::require();
    $token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    preg_match('/Bearer\s+(.+)/i', $token, $m);
    if (!empty($m[1])) {
        $hash = JWT::hash($m[1]);
        Database::exec('UPDATE auth_tokens SET is_valid=0 WHERE token_hash=?', [$hash]);
    }
    Response::ok(null, 'Выход выполнен');
}

// POST /api/auth/switch-role — переключение режима: client / driver / admin
if ($method === 'POST' && $action === 'switch-role') {
    $user = Auth::require();

    $targetRole = $body['target_role'] ?? null;

    // Загружаем полную запись пользователя из БД (там есть is_admin, role и т.д.)
    $dbUser = Database::row('SELECT * FROM users WHERE id = ?', [$user['id']]);
    if (!$dbUser) Response::error('Пользователь не найден', 404);

    // Определяем доступные роли для этого пользователя
    $availableRoles = ['client'];

    // Одобренный водитель
    $driver = Database::row(
        "SELECT id FROM drivers WHERE user_id = ? AND status = 'approved'",
        [$user['id']]
    );
    if ($driver) $availableRoles[] = 'driver';

    // Права администратора: is_admin колонка (после миграции) ИЛИ role='admin' (fallback)
    $hasAdminRight = !empty($dbUser['is_admin']) || $dbUser['role'] === 'admin';
    if ($hasAdminRight) $availableRoles[] = 'admin';

    // Если target_role не указан — старая логика toggle driver/client
    if (!$targetRole) {
        if ($user['role'] === 'driver') {
            $targetRole = 'client';
        } elseif ($user['role'] === 'client' && $driver) {
            $targetRole = 'driver';
        } else {
            Response::error('Укажите target_role', 400);
        }
    }

    // Проверяем что переключение разрешено
    if (!in_array($targetRole, $availableRoles)) {
        Response::error("Переключение в режим '$targetRole' недоступно", 403);
    }

    $newRole = $targetRole;

    // Меняем роль в БД
    Database::exec('UPDATE users SET role = ? WHERE id = ?', [$newRole, $user['id']]);

    // Инвалидируем старый токен
    $oldHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    preg_match('/Bearer\s+(.+)/i', $oldHeader, $m);
    if (!empty($m[1])) {
        Database::exec('UPDATE auth_tokens SET is_valid = 0 WHERE token_hash = ?', [JWT::hash($m[1])]);
    }

    // Выпускаем новый JWT с новой ролью
    $payload   = ['user_id' => $user['id'], 'phone' => $user['phone'], 'role' => $newRole];
    $token     = JWT::encode($payload, $config['jwt']['expires']);
    $tokenHash = JWT::hash($token);
    $expiresAt = date('Y-m-d H:i:s', time() + $config['jwt']['expires']);

    Database::insert(
        'INSERT INTO auth_tokens (user_id, token_hash, device_info, ip, expires_at) VALUES (?,?,?,?,?)',
        [
            $user['id'],
            $tokenHash,
            $_SERVER['HTTP_USER_AGENT'] ?? null,
            $_SERVER['REMOTE_ADDR']     ?? null,
            $expiresAt,
        ]
    );

    Response::ok([
        'token' => $token,
        'role'  => $newRole,
        'user'  => [
            'id'    => $user['id'],
            'phone' => $user['phone'],
            'name'  => $user['name'],
            'role'  => $newRole,
        ],
    ], $newRole === 'driver' ? 'Режим водителя активирован' : 'Режим пассажира активирован');
}

Response::notFound("Auth: неизвестное действие '$action'");