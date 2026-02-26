<?php
// ============================================================
// JWT.php — Минималистичная JWT без внешних библиотек
// Поддерживает HS256
// ============================================================

class JWT {
    private static string $secret = '';

    public static function init(string $secret): void {
        self::$secret = $secret;
    }

    public static function encode(array $payload, int $ttl): string {
        $payload['iat'] = time();
        $payload['exp'] = time() + $ttl;

        $header  = self::b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body    = self::b64url(json_encode($payload));
        $sig     = self::b64url(hash_hmac('sha256', "$header.$body", self::$secret, true));

        return "$header.$body.$sig";
    }

    public static function decode(string $token): ?array {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        [$header, $body, $sig] = $parts;

        // Проверяем подпись
        $expected = self::b64url(hash_hmac('sha256', "$header.$body", self::$secret, true));
        if (!hash_equals($expected, $sig)) return null;

        $payload = json_decode(self::b64urlDecode($body), true);
        if (!$payload) return null;

        // Проверяем срок
        if (isset($payload['exp']) && $payload['exp'] < time()) return null;

        return $payload;
    }

    // Хэш токена для хранения в БД
    public static function hash(string $token): string {
        return hash('sha256', $token);
    }

    private static function b64url(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $data): string {
        return base64_decode(str_pad(strtr($data, '-_', '+/'), strlen($data) % 4, '=', STR_PAD_RIGHT));
    }
}
