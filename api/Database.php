<?php
// ============================================================
// Database.php — PDO-обёртка с удобными методами
// ============================================================

class Database {
    private static ?PDO $instance = null;
    private static array $cfg = [];

    public static function init(array $cfg): void {
        self::$cfg = $cfg;
    }

    public static function get(): PDO {
        if (self::$instance === null) {
            $c = self::$cfg;
            $dsn = "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset={$c['charset']}";
            self::$instance = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone='+05:00'",
            ]);
        }
        return self::$instance;
    }

    // Быстрый SELECT с привязкой параметров
    public static function query(string $sql, array $params = []): array {
        $stmt = self::get()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    // Одна строка
    public static function row(string $sql, array $params = []): ?array {
        $rows = self::query($sql, $params);
        return $rows[0] ?? null;
    }

    // Одно значение
    public static function scalar(string $sql, array $params = []) {
        $row = self::row($sql, $params);
        if (!$row) return null;
        return array_values($row)[0];
    }

    // INSERT / UPDATE / DELETE — возвращает кол-во затронутых строк
    public static function exec(string $sql, array $params = []): int {
        $stmt = self::get()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    // INSERT — возвращает последний вставленный ID
    public static function insert(string $sql, array $params = []): int {
        self::exec($sql, $params);
        return (int) self::get()->lastInsertId();
    }

    // Транзакция-обёртка
    public static function transaction(callable $fn) {
        $pdo = self::get();
        $pdo->beginTransaction();
        try {
            $result = $fn($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}
