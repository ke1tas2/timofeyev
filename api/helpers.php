<?php
// ============================================================
// Response.php — Унифицированные JSON-ответы
// ============================================================

class Response {
    public static function ok($data = null, string $message = 'OK', int $code = 200): never {
        http_response_code($code);
        echo json_encode([
            'success' => true,
            'message' => $message,
            'data'    => $data,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function error(string $message, int $code = 400, $errors = null): never {
        http_response_code($code);
        echo json_encode([
            'success' => false,
            'message' => $message,
            'errors'  => $errors,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function unauthorized(string $message = 'Требуется авторизация'): never {
        self::error($message, 401);
    }

    public static function forbidden(string $message = 'Доступ запрещён'): never {
        self::error($message, 403);
    }

    public static function notFound(string $message = 'Не найдено'): never {
        self::error($message, 404);
    }
}

// ============================================================
// Auth.php — middleware для проверки JWT и ролей
// ============================================================

class Auth {
    private static ?array $currentUser = null;

    // Проверяет токен, возвращает пользователя или null
    public static function user(): ?array {
        if (self::$currentUser !== null) return self::$currentUser;

        $token = self::extractToken();
        if (!$token) return null;

        $payload = JWT::decode($token);
        if (!$payload || empty($payload['user_id'])) return null;

        // Проверяем что токен не отозван
        $tokenHash = JWT::hash($token);
        $record = Database::row(
            'SELECT t.is_valid, t.expires_at, u.id, u.phone, u.name, u.role, u.status
             FROM auth_tokens t
             JOIN users u ON u.id = t.user_id
             WHERE t.token_hash = ? AND t.user_id = ?',
            [$tokenHash, $payload['user_id']]
        );

        if (!$record || !$record['is_valid'] || $record['status'] !== 'active') return null;

        self::$currentUser = $record;
        return $record;
    }

    // Обязательная авторизация
    public static function require(): array {
        $user = self::user();
        if (!$user) Response::unauthorized();
        return $user;
    }

    // Проверка роли
    public static function requireRole(string ...$roles): array {
        $user = self::require();
        if (!in_array($user['role'], $roles)) Response::forbidden();
        return $user;
    }

    private static function extractToken(): ?string {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) return $m[1];

        // Fallback: из куки
        return $_COOKIE['tf_token'] ?? null;
    }
}

// ============================================================
// SMS.php — отправка OTP через провайдеров
// ============================================================

class SMS {
    private static array $cfg = [];

    public static function init(array $cfg): void {
        self::$cfg = $cfg;
    }

    public static function send(string $phone, string $message): bool {
        $provider = self::$cfg['provider'] ?? 'mock';

        return match($provider) {
            'smsc'    => self::sendSmsc($phone, $message),
            'mobizon' => self::sendMobizon($phone, $message),
            default   => self::sendMock($phone, $message),
        };
    }

    private static function sendSmsc(string $phone, string $message): bool {
        $c = self::$cfg['smsc'];
        $url = 'https://smsc.ru/sys/send.php?' . http_build_query([
            'login'   => $c['login'],
            'psw'     => $c['password'],
            'phones'  => $phone,
            'mes'     => $message,
            'sender'  => $c['sender'],
            'charset' => 'utf-8',
            'fmt'     => 1,
        ]);
        $result = @file_get_contents($url);
        return $result && strpos($result, 'ERROR') === false;
    }

    private static function sendMobizon(string $phone, string $message): bool {
        $c = self::$cfg['mobizon'];
        $url = 'https://api.mobizon.kz/service/Message/SendSmsMessage';
        $data = http_build_query([
            'apiKey'      => $c['api_key'],
            'recipient'   => $phone,
            'text'        => $message,
            'alphaName'   => $c['sender'],
        ]);
        $ctx = stream_context_create(['http' => [
            'method'  => 'POST',
            'header'  => 'Content-Type: application/x-www-form-urlencoded',
            'content' => $data,
        ]]);
        $result = @file_get_contents($url, false, $ctx);
        if (!$result) return false;
        $json = json_decode($result, true);
        return ($json['code'] ?? -1) === 0;
    }

    private static function sendMock(string $phone, string $message): bool {
        // Для разработки — пишем в лог
        error_log("[SMS MOCK] To: $phone | $message");
        return true;
    }
}
