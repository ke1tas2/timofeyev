<?php
// ============================================================
// index.php — Главный роутер API Timofeyev Transfer
// ============================================================

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

$config = require __DIR__ . '/config.php';
require __DIR__ . '/Database.php';
require __DIR__ . '/JWT.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/WebPush.php';   // ← Web Push библиотека

date_default_timezone_set($config['app']['timezone']);

Database::init($config['db']);
JWT::init($config['jwt']['secret']);
SMS::init($config['sms']);
WebPush::init(                       // ← Инициализация VAPID
    $config['vapid']['public_key'],
    $config['vapid']['private_key'],
    $config['vapid']['subject']
);

// ── CORS ────────────────────────────────────────────────────
$origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['cors']['allowed_origins'];
if (in_array($origin, $allowed)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$body = [];
$raw  = file_get_contents('php://input');
if ($raw) $body = json_decode($raw, true) ?? [];

$path     = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
$path     = preg_replace('#^api/?#', '', $path);
$method   = $_SERVER['REQUEST_METHOD'];
$segments = array_values(array_filter(explode('/', $path)));

$resource  = $segments[0] ?? '';
$id        = isset($segments[1]) && is_numeric($segments[1]) ? (int)$segments[1] : null;
$subaction = $segments[2] ?? ($id === null ? ($segments[1] ?? '') : '');

try {
    switch ($resource) {
        case 'auth':
            // Социальный вход отделяем: /api/auth/social/{provider}/{step}
            if (($segments[1] ?? '') === 'social') {
                require __DIR__ . '/routes/social.php';
            }
            require __DIR__ . '/routes/auth.php';
            break;
        case 'orders':   require __DIR__ . '/routes/orders.php';  break;
        case 'drivers':  require __DIR__ . '/routes/drivers.php'; break;
        case 'profile':  require __DIR__ . '/routes/profile.php'; break;
        case 'admin':    require __DIR__ . '/routes/admin.php';   break;
        case 'push':     require __DIR__ . '/routes/push.php';    break;  // ← Push-подписки

        case 'notifications':
            // GET  /api/notifications        — история
            // PATCH /api/notifications/read  — прочитано
            $user = Auth::require();
            if ($method === 'GET') {
                $notifs = Database::query(
                    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
                    [$user['id']]
                );
                $unread = (int)Database::scalar(
                    'SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0',
                    [$user['id']]
                );
                Response::ok(['notifications' => $notifs, 'unread' => $unread]);
            }
            if ($method === 'PATCH' && ($subaction === 'read' || $segments[1] === 'read')) {
                Database::exec('UPDATE notifications SET is_read=1 WHERE user_id=?', [$user['id']]);
                Response::ok(null, 'Отмечено как прочитанное');
            }
            Response::notFound();

        case 'tariffs':
            if ($method === 'GET') {
                Response::ok(Database::query('SELECT * FROM tariffs WHERE is_active=1 ORDER BY sort_order'));
            }
            Response::notFound();

        case 'ping':
            Response::ok(['time' => date('c')], 'pong');

        default:
            Response::notFound("Маршрут не найден: $resource");
    }
} catch (PDOException $e) {
    error_log('[DB ERROR] ' . $e->getMessage());
    if ($config['app']['debug']) Response::error('Ошибка БД: ' . $e->getMessage(), 500);
    Response::error('Внутренняя ошибка сервера', 500);
} catch (Throwable $e) {
    error_log('[APP ERROR] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if ($config['app']['debug']) Response::error($e->getMessage(), 500);
    Response::error('Внутренняя ошибка сервера', 500);
}