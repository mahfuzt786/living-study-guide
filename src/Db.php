<?php

declare(strict_types=1);

namespace StudyApp;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }
        $dir = Config::dataDir();
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new \RuntimeException("Cannot create data directory: $dir");
        }
        $pdo = new PDO('sqlite:' . $dir . '/study.sqlite', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA journal_mode = WAL');
        self::migrate($pdo);
        return self::$pdo = $pdo;
    }

    /** @return list<array<string, mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    /** @return array<string, mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = []): mixed
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function run(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $table, array $row): int
    {
        $cols = array_keys($row);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(', ', $cols),
            implode(', ', array_map(fn ($c) => ':' . $c, $cols))
        );
        self::pdo()->prepare($sql)->execute($row);
        return (int) self::pdo()->lastInsertId();
    }

    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    public static function setting(string $key, string $default = ''): string
    {
        $v = self::value('SELECT value FROM settings WHERE key = ?', [$key]);
        return is_string($v) ? $v : $default;
    }

    public static function setSetting(string $key, string $value): void
    {
        self::run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$key, $value]);
    }

    private static function migrate(PDO $pdo): void
    {
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 1) {
            $pdo->exec(<<<'SQL'
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE login_attempts (
                    id INTEGER PRIMARY KEY,
                    ip TEXT NOT NULL,
                    at INTEGER NOT NULL
                );
                CREATE TABLE settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE sources (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    topic TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL,
                    chunk_count INTEGER NOT NULL DEFAULT 1,
                    chunks_done INTEGER NOT NULL DEFAULT 0,
                    extractor TEXT NOT NULL DEFAULT '',
                    is_demo INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE items (
                    id INTEGER PRIMARY KEY,
                    source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    statement TEXT NOT NULL DEFAULT '',
                    interpretation TEXT NOT NULL DEFAULT '',
                    card_front TEXT NOT NULL DEFAULT '',
                    card_back TEXT NOT NULL DEFAULT '',
                    steps TEXT NOT NULL DEFAULT '[]',
                    tags TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'pending',
                    origin TEXT NOT NULL DEFAULT 'manual',
                    model TEXT NOT NULL DEFAULT '',
                    draft TEXT,
                    edited INTEGER NOT NULL DEFAULT 0,
                    merged_into INTEGER REFERENCES items(id) ON DELETE SET NULL,
                    box INTEGER NOT NULL DEFAULT 0,
                    due_at TEXT,
                    times_right INTEGER NOT NULL DEFAULT 0,
                    times_wrong INTEGER NOT NULL DEFAULT 0,
                    last_studied_at TEXT,
                    created_at TEXT NOT NULL,
                    reviewed_at TEXT
                );
                CREATE INDEX items_status ON items(status);
                CREATE INDEX items_source ON items(source_id);
                CREATE TABLE excerpts (
                    id INTEGER PRIMARY KEY,
                    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                    text TEXT NOT NULL,
                    quoted TEXT NOT NULL DEFAULT '',
                    start INTEGER,
                    length INTEGER,
                    match TEXT NOT NULL
                );
                CREATE INDEX excerpts_item ON excerpts(item_id);
                CREATE INDEX excerpts_source ON excerpts(source_id);
                CREATE TABLE study_log (
                    id INTEGER PRIMARY KEY,
                    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                    mode TEXT NOT NULL,
                    result TEXT NOT NULL,
                    at TEXT NOT NULL
                );
                CREATE INDEX study_log_at ON study_log(at);
                CREATE TABLE review_log (
                    id INTEGER PRIMARY KEY,
                    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
                    action TEXT NOT NULL,
                    at TEXT NOT NULL
                );
                PRAGMA user_version = 1;
                SQL);
        }
    }
}
