<?php
// ============================================================
// WebPush.php — Web Push с VAPID (RFC 8292) + шифрованием RFC 8291
// Без внешних библиотек. Требует: PHP 7.3+, OpenSSL, GMP
// ============================================================

class WebPush {

    private static string $vapidPublicKey  = '';
    private static string $vapidPrivateKey = '';
    private static string $vapidSubject    = '';

    public static function init(string $publicKey, string $privateKey, string $subject): void {
        self::$vapidPublicKey  = $publicKey;
        self::$vapidPrivateKey = $privateKey;
        self::$vapidSubject    = $subject;
    }

    // ── Публичные методы ─────────────────────────────────────

    /**
     * Отправить push одному подписчику
     */
    public static function send(array $subscription, array $payload, int $ttl = 86400): bool {
        $endpoint = $subscription['endpoint'] ?? '';
        $p256dh   = $subscription['keys']['p256dh'] ?? null;
        $auth     = $subscription['keys']['auth']   ?? null;
        if (!$endpoint) return false;

        try {
            // Audience для VAPID JWT
            $parsed   = parse_url($endpoint);
            $audience = $parsed['scheme'] . '://' . $parsed['host'];
            if (!empty($parsed['port'])) $audience .= ':' . $parsed['port'];

            $vapidJwt = self::buildVapidJwt($audience);
            if (!$vapidJwt) { error_log('[WebPush] VAPID JWT failed'); return false; }

            $headers = [
                'Authorization: vapid t=' . $vapidJwt . ', k=' . self::$vapidPublicKey,
                'TTL: ' . $ttl,
                'Urgency: high',
            ];

            $body = '';
            if ($p256dh && $auth) {
                $encrypted = self::encrypt(json_encode($payload, JSON_UNESCAPED_UNICODE), $p256dh, $auth);
                if ($encrypted) {
                    $body      = $encrypted;
                    $headers[] = 'Content-Type: application/octet-stream';
                    $headers[] = 'Content-Encoding: aes128gcm';
                    $headers[] = 'Content-Length: ' . strlen($body);
                }
            }
            if (!$body) $headers[] = 'Content-Length: 0';

            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 15,
                CURLOPT_SSL_VERIFYPEER => true,
            ]);
            $curlError  = '';
            curl_setopt($ch, CURLOPT_FAILONERROR, false);
            $response   = curl_exec($ch);
            $statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError  = curl_error($ch);
            curl_close($ch);

            if ($curlError) error_log("[WebPush] cURL error for $endpoint: $curlError");

            // Подписка протухла — удаляем
            if ($statusCode === 410 || $statusCode === 404) {
                self::deleteEndpoint($endpoint);
            }

            return $statusCode >= 200 && $statusCode < 300;

        } catch (Throwable $e) {
            error_log('[WebPush] send exception: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Отправить push всем подпискам пользователя
     */
    public static function sendToUser(int $userId, array $payload, int $ttl = 86400): void {
        try {
            $subs = Database::query(
                'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
                [$userId]
            );
            foreach ($subs as $s) {
                self::send(['endpoint' => $s['endpoint'], 'keys' => ['p256dh' => $s['p256dh'], 'auth' => $s['auth']]], $payload, $ttl);
            }
        } catch (Throwable $e) {
            error_log('[WebPush] sendToUser: ' . $e->getMessage());
        }
    }

    /**
     * Отправить всем администраторам (is_admin=1) — ВСЕГДА, независимо от статуса
     */
    public static function sendToAdmins(array $payload, int $ttl = 86400): void {
        try {
            $subs = Database::query(
                "SELECT ps.endpoint, ps.p256dh, ps.auth
                 FROM push_subscriptions ps
                 JOIN users u ON u.id = ps.user_id
                 WHERE u.is_admin = 1 OR u.role = 'admin'",
                []
            );
            foreach ($subs as $s) {
                self::send(['endpoint' => $s['endpoint'], 'keys' => ['p256dh' => $s['p256dh'], 'auth' => $s['auth']]], $payload, $ttl);
            }
        } catch (Throwable $e) {
            error_log('[WebPush] sendToAdmins: ' . $e->getMessage());
        }
    }

    /**
     * Отправить всем онлайн-водителям (is_online=1)
     */
    public static function sendToOnlineDrivers(array $payload, int $ttl = 3600): void {
        try {
            $subs = Database::query(
                "SELECT ps.endpoint, ps.p256dh, ps.auth
                 FROM push_subscriptions ps
                 JOIN users u ON u.id = ps.user_id
                 JOIN drivers d ON d.user_id = u.id
                 WHERE d.is_online = 1 AND d.status = 'approved' AND u.role = 'driver'",
                []
            );
            foreach ($subs as $s) {
                self::send(['endpoint' => $s['endpoint'], 'keys' => ['p256dh' => $s['p256dh'], 'auth' => $s['auth']]], $payload, $ttl);
            }
        } catch (Throwable $e) {
            error_log('[WebPush] sendToOnlineDrivers: ' . $e->getMessage());
        }
    }

    /**
     * Сохранить уведомление в БД (для истории) и отправить push
     */
    public static function notify(int $userId, string $type, string $title, string $body, array $data = [], string $url = '/'): void {
        try {
            Database::insert(
                'INSERT INTO notifications (user_id, type, title, body, data, url) VALUES (?,?,?,?,?,?)',
                [$userId, $type, $title, $body, json_encode($data, JSON_UNESCAPED_UNICODE), $url]
            );
            self::sendToUser($userId, [
                'title' => $title,
                'body'  => $body,
                'icon'  => '/assets/icons/icon-192.png',
                'badge' => '/assets/icons/icon-192.png',
                'url'   => $url,
                'type'  => $type,
                'data'  => $data,
            ]);
        } catch (Throwable $e) {
            error_log('[WebPush] notify: ' . $e->getMessage());
        }
    }

    /**
     * Сохранить уведомление для всех администраторов + отправить push
     */
    public static function notifyAdmins(string $type, string $title, string $body, array $data = [], string $url = '/admin.html'): void {
        try {
            $admins = Database::query(
                "SELECT id FROM users WHERE is_admin = 1 OR role = 'admin'",
                []
            );
            foreach ($admins as $admin) {
                Database::insert(
                    'INSERT INTO notifications (user_id, type, title, body, data, url) VALUES (?,?,?,?,?,?)',
                    [$admin['id'], $type, $title, $body, json_encode($data, JSON_UNESCAPED_UNICODE), $url]
                );
            }
            self::sendToAdmins([
                'title' => $title,
                'body'  => $body,
                'icon'  => '/assets/icons/icon-192.png',
                'badge' => '/assets/icons/icon-192.png',
                'url'   => $url,
                'type'  => $type,
                'data'  => $data,
            ]);
        } catch (Throwable $e) {
            error_log('[WebPush] notifyAdmins: ' . $e->getMessage());
        }
    }

    // ── VAPID JWT (RFC 8292, алгоритм ES256) ─────────────────

    private static function buildVapidJwt(string $audience): ?string {
        $header  = self::b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $payload = self::b64u(json_encode([
            'aud' => $audience,
            'exp' => time() + 43200,        // 12 часов
            'sub' => self::$vapidSubject,
        ]));
        $input = "$header.$payload";

        $privPem = self::rawPrivToPem(self::b64uDec(self::$vapidPrivateKey));
        if (!$privPem) return null;

        $privKey = openssl_pkey_get_private($privPem);
        if (!$privKey) return null;

        if (!openssl_sign($input, $derSig, $privKey, OPENSSL_ALGO_SHA256)) return null;

        $rawSig = self::derSigToRaw($derSig);
        if (!$rawSig) return null;

        return "$input." . self::b64u($rawSig);
    }

    /** DER-подпись → raw r||s (64 байта) */
    private static function derSigToRaw(string $der): ?string {
        $offset = 2;
        // Длинная форма длины
        if (ord($der[1]) & 0x80) {
            $offset += ord($der[1]) & 0x7f;
        }
        if (ord($der[$offset]) !== 0x02) return null;
        $rLen = ord($der[$offset + 1]);
        $r    = substr($der, $offset + 2, $rLen);
        $offset += 2 + $rLen;
        if (ord($der[$offset]) !== 0x02) return null;
        $sLen = ord($der[$offset + 1]);
        $s    = substr($der, $offset + 2, $sLen);
        $r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
        $s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
        return $r . $s;
    }

    /** Raw 32-байтный приватный ключ P-256 → PEM */
    private static function rawPrivToPem(string $raw): ?string {
        if (strlen($raw) !== 32) return null;
        // OID prime256v1: 1.2.840.10045.3.1.7
        $oid = hex2bin('2a8648ce3d030107');
        $body = "\x02\x01\x01\x04\x20" . $raw . "\xa0\x0a\x06\x08" . $oid;
        $seq  = "\x30" . self::derLen(strlen($body)) . $body;
        return "-----BEGIN EC PRIVATE KEY-----\n"
             . chunk_split(base64_encode($seq), 64, "\n")
             . "-----END EC PRIVATE KEY-----\n";
    }

    // ── RFC 8291 Payload Encryption ──────────────────────────

    private static function encrypt(string $plaintext, string $p256dhB64, string $authB64): ?string {
        try {
            $recipPub    = self::b64uDec($p256dhB64);    // 65 байт (04 || x || y)
            $authSecret  = self::b64uDec($authB64);       // 16 байт

            if (strlen($recipPub) !== 65 || $recipPub[0] !== "\x04") {
                error_log('[WebPush] Invalid p256dh length: ' . strlen($recipPub));
                return null;
            }

            // Генерируем эфемерную пару ключей
            $ephKey = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
            if (!$ephKey) { error_log('[WebPush] openssl_pkey_new failed'); return null; }

            $ephDetails  = openssl_pkey_get_details($ephKey);
            $ephPub      = "\x04"
                         . str_pad($ephDetails['ec']['x'], 32, "\x00", STR_PAD_LEFT)
                         . str_pad($ephDetails['ec']['y'], 32, "\x00", STR_PAD_LEFT);

            // Публичный ключ получателя → ресурс OpenSSL
            $recipKeyRes = self::importPubKey($recipPub);
            if (!$recipKeyRes) { error_log('[WebPush] importPubKey failed'); return null; }

            // ECDH
            $ecdhSecret = openssl_pkey_derive($recipKeyRes, $ephKey, 32);
            if (!$ecdhSecret) { error_log('[WebPush] openssl_pkey_derive failed'); return null; }

            // ── RFC 8291 §3.3 Key Derivation ──────────────────
            // PRK_key = HKDF-Extract(auth_secret, ecdh_secret)
            $prkKey  = hash_hmac('sha256', $ecdhSecret, $authSecret, true);
            // IKM = HKDF-Expand(PRK_key, "WebPush: info\x00" || ua_pub || as_pub, 32)
            $keyInfo = "WebPush: info\x00" . $recipPub . $ephPub;
            $ikm     = hash_hmac('sha256', $keyInfo . "\x01", $prkKey, true);

            // Соль
            $salt = random_bytes(16);

            // PRK = HKDF-Extract(salt, IKM)
            $prk   = hash_hmac('sha256', $ikm, $salt, true);
            // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\x00", 16)
            $cek   = substr(hash_hmac('sha256', "Content-Encoding: aes128gcm\x00\x01", $prk, true), 0, 16);
            // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\x00", 12)
            $nonce = substr(hash_hmac('sha256', "Content-Encoding: nonce\x00\x01", $prk, true), 0, 12);

            // Шифрование AES-128-GCM
            $tag        = '';
            $ciphertext = openssl_encrypt(
                $plaintext . "\x02",  // разделитель последней записи
                'aes-128-gcm',
                $cek,
                OPENSSL_RAW_DATA,
                $nonce,
                $tag,
                '',
                16
            );
            if ($ciphertext === false) { error_log('[WebPush] AES-GCM encrypt failed'); return null; }

            // Заголовок: salt(16) + rs(4) + keyid_len(1) + keyid(65)
            $header = $salt . pack('N', 4096) . chr(65) . $ephPub;
            return $header . $ciphertext . $tag;

        } catch (Throwable $e) {
            error_log('[WebPush] encrypt exception: ' . $e->getMessage() . ' ' . $e->getFile() . ':' . $e->getLine());
            return null;
        }
    }

    /** Импорт сырого несжатого публичного ключа P-256 в ресурс OpenSSL */
    private static function importPubKey(string $raw): mixed {
        // SubjectPublicKeyInfo DER для EC + prime256v1
        $algId  = hex2bin('301306072a8648ce3d020106082a8648ce3d030107');
        $bitStr = "\x03" . self::derLen(strlen($raw) + 1) . "\x00" . $raw;
        $spki   = "\x30" . self::derLen(strlen($algId) + strlen($bitStr)) . $algId . $bitStr;
        $pem    = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
        return openssl_pkey_get_public($pem);
    }

    private static function deleteEndpoint(string $endpoint): void {
        try {
            Database::exec('DELETE FROM push_subscriptions WHERE endpoint = ?', [$endpoint]);
        } catch (Throwable $e) {
            error_log('[WebPush] deleteEndpoint: ' . $e->getMessage());
        }
    }

    // ── Вспомогательные ──────────────────────────────────────

    /** DER-длина */
    private static function derLen(int $len): string {
        if ($len < 128)   return chr($len);
        if ($len < 256)   return "\x81" . chr($len);
        return "\x82" . chr($len >> 8) . chr($len & 0xff);
    }

    public static function b64u(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function b64uDec(string $data): string {
        return base64_decode(str_pad(strtr($data, '-_', '+/'), strlen($data) % 4, '=', STR_PAD_RIGHT));
    }
}
