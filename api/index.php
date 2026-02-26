<?php
// ============================================================
// index.php — Главный роутер API Timofeyev Transfer
// Все запросы приходят сюда через .htaccess
// ============================================================

// ── Настройки PHP ───────────────────────────────────────────
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// ── Заголовки ───────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

// ── Загрузка конфигурации и зависимостей ────────────────────
$config = require __DIR__ . '/config.php';
require __DIR__ . '/Database.php';
require __DIR__ . '/JWT.php';
require __DIR__ . '/helpers.php';   // Response, Auth, SMS

// Временная зона
date_default_timezone_set($config['app']['timezone']);

// Инициализация компонентов
Database::init($config['db']);
JWT::init($config['jwt']['secret']);
SMS::init($config['sms']);

// ── CORS ────────────────────────────────────────────────────
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['cors']['allowed_origins'];

if (in_array($origin, $allowed)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Получаем тело запроса ───────────────────────────────────
$body = [];
$raw  = file_get_contents('php://input');
if ($raw) {
    $body = json_decode($raw, true) ?? [];
}

// ── Разбираем маршрут ───────────────────────────────────────
$path   = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
$path   = preg_replace('#^api/?#', '', $path);  // убираем префикс /api/
$method = $_SERVER['REQUEST_METHOD'];

// Разбиваем: /orders/123/status → ['orders','123','status']
$segments = array_filter(explode('/', $path));
$segments = array_values($segments);

$resource  = $segments[0] ?? '';
$id        = isset($segments[1]) && is_numeric($segments[1]) ? (int)$segments[1] : null;
$subaction = $segments[2] ?? ($id === null ? ($segments[1] ?? '') : '');

// ── Маршрутизация ───────────────────────────────────────────
try {
    switch ($resource) {

        // ── AUTH ─────────────────────────────────────────────
        case 'auth':
            require __DIR__ . '/routes/auth.php';
            break;

        // ── ORDERS ──────────────────────────────────────────
        case 'orders':
            require __DIR__ . '/routes/orders.php';
            break;

        // ── DRIVERS ─────────────────────────────────────────
        case 'drivers':
            require __DIR__ . '/routes/drivers.php';
            break;

        // ── PROFILE ─────────────────────────────────────────
        case 'profile':
            require __DIR__ . '/routes/profile.php';
            break;

        // ── ADMIN ───────────────────────────────────────────
        case 'admin':
            require __DIR__ . '/routes/admin.php';
            break;

        // ── TARIFFS ─────────────────────────────────────────
        case 'tariffs':
            if ($method === 'GET') {
                $tariffs = Database::query('SELECT * FROM tariffs WHERE is_active=1 ORDER BY sort_order');
                Response::ok($tariffs);
            }
            Response::notFound();

        // ── HEALTH CHECK ────────────────────────────────────
        case 'ping':
            Response::ok(['time' => date('c')], 'pong');

        default:
            Response::notFound("Маршрут не найден: $resource");
    }

} catch (PDOException $e) {
    error_log('[DB ERROR] ' . $e->getMessage());
    if ($config['app']['debug']) {
        Response::error('Ошибка базы данных: ' . $e->getMessage(), 500);
    }
    Response::error('Внутренняя ошибка сервера', 500);

} catch (Throwable $e) {
    error_log('[APP ERROR] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if ($config['app']['debug']) {
        Response::error($e->getMessage(), 500);
    }
    Response::error('Внутренняя ошибка сервера', 500);
}
