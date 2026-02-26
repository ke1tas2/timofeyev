<?php
// ============================================================
// config.php — Конфигурация приложения Timofeyev Transfer
// ============================================================
// !! ПЕРЕИМЕНУЙТЕ config.example.php → config.php !!
// !! НЕ ДОБАВЛЯЙТЕ ЭТОТ ФАЙЛ В GIT / ПУБЛИЧНЫЙ ДОСТУП !!

return [

    // ── База данных ─────────────────────────────────────────
    'db' => [
        'host'    => 'localhost',
        'port'    => 3306,
        'name'    => 'timofee1_transfer',   // Имя БД на ps.kz
        'user'    => 'timofee1_user', // Пользователь БД
        'pass'    => 'DFVttpquz5vp1_%7',      // Пароль БД
        'charset' => 'utf8mb4',
    ],

    // ── JWT ─────────────────────────────────────────────────
    'jwt' => [
        'secret'  => 'timofeyev2026xKpQmRnLvBsTwYcAjDhFu',
        'expires' => 86400 * 30, // 30 дней (секунды)
    ],

    // ── SMS-провайдер ────────────────────────────────────────
    // Рекомендуемые провайдеры для Казахстана:
    //   smsc.ru  — дешёво, есть KZ-номера
    //   mobizon.kz — казахстанский провайдер
    //   sms.kz
    'sms' => [
        'provider' => 'mock',     // 'smsc' | 'mobizon' | 'mock'
        'smsc' => [
            'login'    => 'YOUR_SMSC_LOGIN',
            'password' => 'YOUR_SMSC_PASSWORD',
            'sender'   => 'Timofeyev',
        ],
        'mobizon' => [
            'api_key'  => 'YOUR_MOBIZON_API_KEY',
            'sender'   => 'Timofeyev',
        ],
        // 'mock' — для разработки: OTP всегда 123456
    ],

    // ── OTP ─────────────────────────────────────────────────
    'otp' => [
        'length'   => 6,
        'ttl'      => 300,       // 5 минут
        'max_attempts' => 3,     // попыток ввода кода
        'resend_delay' => 60,    // пауза между отправками (сек)
    ],

    // ── Приложение ──────────────────────────────────────────
    'app' => [
        'name'          => 'Timofeyev Transfer',
        'url'           => 'https://timofeyev.kz',
        'api_url'       => 'https://timofeyev.kz/api',
        'debug'         => false,  // true только при разработке!
        'timezone'      => 'Asia/Almaty',
        'upload_dir'    => __DIR__ . '/../uploads/',
        'upload_url'    => 'https://timofeyev.kz/uploads/',
    ],

    // ── CORS ────────────────────────────────────────────────
    'cors' => [
        'allowed_origins' => [
            'https://calc.timofeev.kz',
            'https://timofeyev.kz',
            'https://www.timofeyev.kz',
            'https://timofeyev.kz/quote'
            // Разрешить Tilda если нужно:
            // 'https://timofeyev.tilda.ws',
        ],
    ],
];
