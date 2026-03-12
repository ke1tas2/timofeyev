<?php
// ============================================================
// routes/social.php — Вход через социальные сети (OAuth 2.0)
// ============================================================
// GET  /api/auth/social/{provider}/url       — получить URL для редиректа
// GET  /api/auth/social/{provider}/callback  — обработать callback от провайдера
//
// Поддерживаемые провайдеры: google, vk, apple, mailru
// ============================================================

$provider = $segments[2] ?? '';
$step     = $segments[3] ?? '';

$socialCfg = $config['social'] ?? [];

// ── Получить OAuth URL ───────────────────────────────────────
if ($method === 'GET' && $step === 'url') {
    $url = getSocialAuthUrl($provider, $socialCfg);
    if (!$url) Response::error("Провайдер '$provider' не поддерживается или не настроен", 400);
    Response::ok(['url' => $url]);
}

// ── Callback от провайдера ───────────────────────────────────
if ($method === 'GET' && $step === 'callback') {
    $code  = $_GET['code']  ?? '';
    $state = $_GET['state'] ?? '';
    $error = $_GET['error'] ?? '';

    if ($error) {
        outputCallbackPage(null, 'Вход отменён');
        exit;
    }
    if (!$code) {
        outputCallbackPage(null, 'Код авторизации не получен');
        exit;
    }

    // Проверяем state (CSRF)
    $expectedState = md5($provider . ($config['jwt']['secret'] ?? ''));
    if ($state !== $expectedState) {
        outputCallbackPage(null, 'Ошибка безопасности. Попробуйте снова.');
        exit;
    }

    try {
        $userInfo = getSocialUserInfo($provider, $code, $socialCfg);
        if (!$userInfo) {
            outputCallbackPage(null, 'Не удалось получить данные пользователя');
            exit;
        }

        // Ищем или создаём пользователя
        $socialId   = $userInfo['id'];
        $socialEmail = $userInfo['email'] ?? null;
        $socialName  = $userInfo['name'] ?? null;

        // Ищем по social_id + provider в таблице social_accounts
        $user = Database::row(
            'SELECT u.* FROM users u
             JOIN social_accounts sa ON sa.user_id = u.id
             WHERE sa.provider = ? AND sa.social_id = ?',
            [$provider, $socialId]
        );

        // Если нет — ищем по email
        if (!$user && $socialEmail) {
            $user = Database::row('SELECT * FROM users WHERE email = ?', [$socialEmail]);
        }

        // Если нет — создаём нового
        if (!$user) {
            $userId = Database::insert(
                'INSERT INTO users (phone, email, name, role, status) VALUES (?,?,?,?,?)',
                [null, $socialEmail, $socialName, 'client', 'active']
            );
            $user = Database::row('SELECT * FROM users WHERE id = ?', [$userId]);
        }

        // Привязываем социальный аккаунт если ещё не привязан
        $existing = Database::row(
            'SELECT id FROM social_accounts WHERE provider=? AND social_id=?',
            [$provider, $socialId]
        );
        if (!$existing) {
            Database::insert(
                'INSERT INTO social_accounts (user_id, provider, social_id, email, name, avatar) VALUES (?,?,?,?,?,?)',
                [$user['id'], $provider, $socialId, $socialEmail, $socialName, $userInfo['avatar'] ?? null]
            );
        }

        if ($user['status'] !== 'active') {
            outputCallbackPage(null, 'Ваш аккаунт заблокирован');
            exit;
        }

        // Генерируем JWT
        $payload   = ['user_id' => $user['id'], 'phone' => $user['phone'], 'role' => $user['role']];
        $token     = JWT::encode($payload, $config['jwt']['expires']);
        $tokenHash = JWT::hash($token);
        $expiresAt = date('Y-m-d H:i:s', time() + $config['jwt']['expires']);

        Database::insert(
            'INSERT INTO auth_tokens (user_id, token_hash, device_info, ip, expires_at) VALUES (?,?,?,?,?)',
            [$user['id'], $tokenHash, $_SERVER['HTTP_USER_AGENT'] ?? null, $_SERVER['REMOTE_ADDR'] ?? null, $expiresAt]
        );
        Database::exec('UPDATE users SET last_login_at=NOW() WHERE id=?', [$user['id']]);

        $isNew = is_null($user['name']) && !$user['phone'];

        outputCallbackPage([
            'token'  => $token,
            'is_new' => $isNew,
            'user'   => [
                'id'    => $user['id'],
                'phone' => $user['phone'],
                'name'  => $user['name'] ?? $socialName,
                'email' => $user['email'],
                'role'  => $user['role'],
            ],
        ]);

    } catch (Throwable $e) {
        error_log('[SOCIAL AUTH ERROR] ' . $e->getMessage());
        outputCallbackPage(null, 'Ошибка при входе. Попробуйте ещё раз.');
    }
    exit;
}

Response::notFound("Social: неизвестный шаг '$step'");

// ══════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════

function getSocialAuthUrl(string $provider, array $cfg): ?string {
    $appUrl   = $GLOBALS['config']['app']['url'] ?? '';
    $callback = "$appUrl/api/auth/social/$provider/callback";

    switch ($provider) {

        case 'google':
            if (empty($cfg['google']['client_id'])) return null;
            $state = md5('google' . ($GLOBALS['config']['jwt']['secret'] ?? ''));
            return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
                'client_id'     => $cfg['google']['client_id'],
                'redirect_uri'  => $callback,
                'response_type' => 'code',
                'scope'         => 'openid email profile',
                'state'         => $state,
                'access_type'   => 'online',
            ]);

        case 'vk':
            if (empty($cfg['vk']['client_id'])) return null;
            $state = md5('vk' . ($GLOBALS['config']['jwt']['secret'] ?? ''));
            return 'https://oauth.vk.com/authorize?' . http_build_query([
                'client_id'     => $cfg['vk']['client_id'],
                'redirect_uri'  => $callback,
                'response_type' => 'code',
                'scope'         => 'email',
                'v'             => '5.131',
                'state'         => $state,
            ]);

        case 'mailru':
            if (empty($cfg['mailru']['client_id'])) return null;
            $state = md5('mailru' . ($GLOBALS['config']['jwt']['secret'] ?? ''));
            return 'https://oauth.mail.ru/login?' . http_build_query([
                'client_id'     => $cfg['mailru']['client_id'],
                'redirect_uri'  => $callback,
                'response_type' => 'code',
                'scope'         => 'userinfo',
                'state'         => $state,
            ]);

        case 'apple':
            if (empty($cfg['apple']['client_id'])) return null;
            $state = md5('apple' . ($GLOBALS['config']['jwt']['secret'] ?? ''));
            return 'https://appleid.apple.com/auth/authorize?' . http_build_query([
                'client_id'     => $cfg['apple']['client_id'],
                'redirect_uri'  => $callback,
                'response_type' => 'code id_token',
                'scope'         => 'name email',
                'response_mode' => 'form_post',
                'state'         => $state,
            ]);

        default:
            return null;
    }
}

function getSocialUserInfo(string $provider, string $code, array $cfg): ?array {
    $appUrl   = $GLOBALS['config']['app']['url'] ?? '';
    $callback = "$appUrl/api/auth/social/$provider/callback";

    switch ($provider) {

        // ── Google ───────────────────────────────────────────
        case 'google': {
            // Обмениваем code на access_token
            $tokenRes = httpPost('https://oauth2.googleapis.com/token', [
                'code'          => $code,
                'client_id'     => $cfg['google']['client_id'],
                'client_secret' => $cfg['google']['client_secret'],
                'redirect_uri'  => $callback,
                'grant_type'    => 'authorization_code',
            ]);
            if (empty($tokenRes['access_token'])) return null;

            // Получаем профиль
            $profile = httpGet(
                'https://www.googleapis.com/oauth2/v3/userinfo',
                $tokenRes['access_token']
            );
            if (empty($profile['sub'])) return null;

            return [
                'id'     => $profile['sub'],
                'email'  => $profile['email'] ?? null,
                'name'   => trim(($profile['given_name'] ?? '') . ' ' . ($profile['family_name'] ?? '')),
                'avatar' => $profile['picture'] ?? null,
            ];
        }

        // ── VK ───────────────────────────────────────────────
        case 'vk': {
            $tokenRes = httpPost('https://oauth.vk.com/access_token', [
                'code'          => $code,
                'client_id'     => $cfg['vk']['client_id'],
                'client_secret' => $cfg['vk']['client_secret'],
                'redirect_uri'  => $callback,
            ]);
            if (empty($tokenRes['access_token'])) return null;

            $userId = $tokenRes['user_id'] ?? null;
            $email  = $tokenRes['email'] ?? null;

            // Получаем профиль VK
            $usersRes = httpGet(
                'https://api.vk.com/method/users.get?user_ids=' . $userId .
                '&fields=photo_100&v=5.131&access_token=' . $tokenRes['access_token']
            );
            $vkUser = $usersRes['response'][0] ?? [];

            return [
                'id'     => (string)($userId ?? $vkUser['id']),
                'email'  => $email,
                'name'   => trim(($vkUser['first_name'] ?? '') . ' ' . ($vkUser['last_name'] ?? '')),
                'avatar' => $vkUser['photo_100'] ?? null,
            ];
        }

        // ── Mail.ru ──────────────────────────────────────────
        case 'mailru': {
            $tokenRes = httpPost('https://oauth.mail.ru/token', [
                'code'          => $code,
                'client_id'     => $cfg['mailru']['client_id'],
                'client_secret' => $cfg['mailru']['client_secret'],
                'redirect_uri'  => $callback,
                'grant_type'    => 'authorization_code',
            ]);
            if (empty($tokenRes['access_token'])) return null;

            $profile = httpGet(
                'https://oauth.mail.ru/userinfo',
                $tokenRes['access_token']
            );
            if (empty($profile['id'])) return null;

            return [
                'id'     => $profile['id'],
                'email'  => $profile['email'] ?? null,
                'name'   => $profile['name'] ?? null,
                'avatar' => $profile['image'] ?? null,
            ];
        }

        // ── Apple ────────────────────────────────────────────
        case 'apple': {
            // Apple использует JWT client_secret — нужна библиотека или ручная генерация
            // Для упрощения: декодируем id_token (приходит в callback вместе с code для Apple)
            $idToken = $_POST['id_token'] ?? $_GET['id_token'] ?? null;
            if (!$idToken) return null;

            // Декодируем payload из id_token (без верификации — Apple публичные ключи кешируем)
            $parts = explode('.', $idToken);
            if (count($parts) < 2) return null;
            $payload = json_decode(base64_decode(str_pad(strtr($parts[1], '-_', '+/'), strlen($parts[1]) % 4, '=', STR_PAD_RIGHT)), true);
            if (!$payload) return null;

            // Имя приходит только при первом входе через POST
            $nameData = null;
            if (!empty($_POST['user'])) {
                $nameData = json_decode($_POST['user'], true);
            }
            $firstName = $nameData['name']['firstName'] ?? '';
            $lastName  = $nameData['name']['lastName'] ?? '';
            $name = trim("$firstName $lastName") ?: null;

            return [
                'id'     => $payload['sub'],
                'email'  => $payload['email'] ?? null,
                'name'   => $name,
                'avatar' => null,
            ];
        }

        default:
            return null;
    }
}

// ── HTTP-хелперы ─────────────────────────────────────────────
function httpPost(string $url, array $data): array {
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query($data),
        'timeout' => 10,
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    if (!$res) return [];
    return json_decode($res, true) ?? [];
}

function httpGet(string $url, ?string $bearerToken = null): array {
    $headers = "Accept: application/json\r\n";
    if ($bearerToken) $headers .= "Authorization: Bearer $bearerToken\r\n";
    $ctx = stream_context_create(['http' => ['header' => $headers, 'timeout' => 10]]);
    $res = @file_get_contents($url, false, $ctx);
    if (!$res) return [];
    return json_decode($res, true) ?? [];
}

// ── Страница callback — закрывает popup и передаёт данные ────
function outputCallbackPage(?array $data, string $error = ''): void {
    header('Content-Type: text/html; charset=utf-8');
    $json = $data ? json_encode($data, JSON_UNESCAPED_UNICODE) : 'null';
    $errEsc = htmlspecialchars($error);
    echo <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Timofeyev ID</title></head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<script>
(function(){
  var data = {$json};
  var error = "{$errEsc}";
  if(window.opener) {
    window.opener.postMessage({type:'SOCIAL_AUTH',data:data,error:error||null},'*');
    window.close();
  } else {
    // Fallback: не popup — редирект на главную с токеном
    if(data && data.token) {
      localStorage.setItem('tf_token',''+data.token);
      if(data.user) localStorage.setItem('tf_user',JSON.stringify(data.user));
      window.location.replace('/');
    } else {
      document.body.innerHTML = '<p>'+error+'</p><a href="/" style="color:#fc3f1e">На главную</a>';
    }
  }
})();
</script>
<p style="color:#888">Завершение входа...</p>
</body>
</html>
HTML;
}
