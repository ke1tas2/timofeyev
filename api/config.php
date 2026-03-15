<?php
// ============================================================
// config.php — Конфигурация приложения Timofeyev Transfer
// !! НЕ ДОБАВЛЯЙТЕ ЭТОТ ФАЙЛ В GIT / ПУБЛИЧНЫЙ ДОСТУП !!
// ============================================================

return [

    // ── База данных ─────────────────────────────────────────
    'db' => [
        'host'    => 'localhost',
        'port'    => 3306,
        'name'    => 'timofee1_transfer',
        'user'    => 'timofee1_user',
        'pass'    => 'DFVttpquz5vp1_%7',
        'charset' => 'utf8mb4',
    ],

    // ── JWT ─────────────────────────────────────────────────
    'jwt' => [
        'secret'  => 'timofeyev2026xKpQmRnLvBsTwYcAjDhFu',
        'expires' => 86400 * 30,
    ],

    // ── SMS-провайдер ────────────────────────────────────────
    // !! Смените 'mock' на 'mobizon' когда вставите ключ !!
    'sms' => [
        'provider' => 'mock',      // 'mock' | 'mobizon' | 'smsc'
        'smsc' => [
            'login'    => 'YOUR_SMSC_LOGIN',
            'password' => 'YOUR_SMSC_PASSWORD',
            'sender'   => 'Timofeyev',
        ],
        'mobizon' => [
            // !! Скопируйте ключ из Mobizon → Профиль → API-ключ !!
            'api_key'  => 'YOUR_MOBIZON_API_KEY',
            'sender'   => 'Timofeyev',  // Должен быть одобрен в Mobizon как «Отправитель SMS»
        ],
    ],

    // ── OTP ─────────────────────────────────────────────────
    'otp' => [
        'length'       => 6,
        'ttl'          => 300,
        'max_attempts' => 3,
        'resend_delay' => 60,
    ],

    // ── VAPID — Web Push Notifications ─────────────────────
    // !! ЗАПУСТИТЕ generate_vapid.php ОДИН РАЗ и вставьте ключи сюда !!
    // !! После генерации УДАЛИТЕ generate_vapid.php с сервера !!
    'vapid' => [
        'public_key'  => 'BAcY3fKI2t270B-3yezVXTaurc1BtFE_3ph5lLAxXvt5iv37AQ4WZC2XBr44pVRlhrvzzhvJsEXkyxpff1Ue33E',
        'private_key' => 'dNxOQJeN5vntFsjBm7GFbs1G_zswIIWQV5WNyPFcIyg',
        'subject'     => 'mailto:info@timofeyev.kz',  // ваш email
    ],

    // ── Приложение ──────────────────────────────────────────
    'app' => [
        'name'       => 'Timofeyev Transfer',
        'url'        => 'https://timofeyev.kz',
        'api_url'    => 'https://timofeyev.kz/api',
        'debug'      => false,
        'timezone'   => 'Asia/Almaty',
        'upload_dir' => __DIR__ . '/../uploads/',
        'upload_url' => 'https://timofeyev.kz/uploads/',
    ],

    // ── Социальный вход (OAuth 2.0) ─────────────────────────
    // Инструкции по получению ключей: см. SOCIAL_AUTH_SETUP.md
    'social' => [

        // Google — https://console.cloud.google.com/
        //   1. Создать проект → APIs & Services → Credentials → OAuth 2.0 Client ID
        //   2. Тип: Web application
        //   3. Redirect URI: https://timofeyev.kz/api/auth/social/google/callback
        'google' => [
            'client_id'     => 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
            'client_secret' => 'YOUR_GOOGLE_CLIENT_SECRET',
        ],

        // VK ID — https://id.vk.com/business/go
        //   1. Создать приложение → Тип: Web
        //   2. Redirect URI: https://timofeyev.kz/api/auth/social/vk/callback
        'vk' => [
            'client_id'     => 'YOUR_VK_APP_ID',
            'client_secret' => 'YOUR_VK_CLIENT_SECRET',
        ],

        // Mail.ru — https://o2.mail.ru/
        //   1. Создать приложение → Redirect URI: https://timofeyev.kz/api/auth/social/mailru/callback
        'mailru' => [
            'client_id'     => 'YOUR_MAILRU_CLIENT_ID',
            'client_secret' => 'YOUR_MAILRU_CLIENT_SECRET',
        ],

        // Apple Sign In — https://developer.apple.com/
        //   1. Account → Certificates → Identifiers → App ID (включить Sign In with Apple)
        //   2. Service ID → Configure → Redirect URI: https://timofeyev.kz/api/auth/social/apple/callback
        'apple' => [
            'client_id' => 'kz.timofeev.transfer',  // Bundle ID вашего приложения
            'team_id'   => 'YOUR_APPLE_TEAM_ID',
            'key_id'    => 'YOUR_APPLE_KEY_ID',
            'private_key_path' => __DIR__ . '/../keys/apple_auth_key.p8',  // Скачать с Apple Developer
        ],
    ],

    // ── CORS ────────────────────────────────────────────────
    'cors' => [
        'allowed_origins' => [
            'https://calc.timofeev.kz',
            'https://timofeyev.kz',
            'https://www.timofeyev.kz',
            'https://timofeyev.kz/quote',
        ],
    ],
];