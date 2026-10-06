<?php

declare(strict_types=1);

namespace StudyApp;

/**
 * One owner account. The first visit creates it; after that the app only offers a login,
 * so nobody else can register and nothing is visible without signing in.
 */
final class Auth
{
    private const MAX_ATTEMPTS = 5;
    private const WINDOW_SECONDS = 900;

    public static function hasOwner(): bool
    {
        return (int) Db::value('SELECT COUNT(*) FROM users') > 0;
    }

    public static function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!is_int($id)) {
            return null;
        }
        return Db::one('SELECT id, username, created_at FROM users WHERE id = ?', [$id]);
    }

    public static function createOwner(string $username, string $password, string $confirm): void
    {
        if (self::hasOwner()) {
            throw new BadInput('An owner account already exists. Sign in instead.');
        }
        $username = trim($username);
        if (!preg_match('/^[\p{L}\p{N}._@-]{3,60}$/u', $username)) {
            throw new BadInput('Use 3-60 letters, numbers, dots, dashes or underscores for the username.');
        }
        self::checkNewPassword($password, $confirm);
        Db::insert('users', [
            'username' => $username,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'created_at' => now_iso(),
        ]);
        self::login((int) Db::value('SELECT id FROM users WHERE username = ?', [$username]));
    }

    public static function attempt(string $username, string $password, string $ip): bool
    {
        Db::run('DELETE FROM login_attempts WHERE at < ?', [time() - self::WINDOW_SECONDS]);
        if ((int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]) >= self::MAX_ATTEMPTS) {
            throw new BadInput('Too many failed sign-in attempts. Try again in 15 minutes.');
        }
        $user = Db::one('SELECT id, password_hash FROM users WHERE username = ?', [trim($username)]);
        // Do the same hashing work for unknown usernames so timing does not reveal which exist.
        $hash = $user['password_hash'] ?? password_hash(random_bytes(16), PASSWORD_DEFAULT);
        if (!password_verify($password, $hash) || $user === null) {
            Db::insert('login_attempts', ['ip' => $ip, 'at' => time()]);
            return false;
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            Db::run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        Db::run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        self::login((int) $user['id']);
        return true;
    }

    public static function changePassword(int $userId, string $current, string $new, string $confirm): void
    {
        $hash = (string) Db::value('SELECT password_hash FROM users WHERE id = ?', [$userId]);
        if (!password_verify($current, $hash)) {
            throw new BadInput('Your current password is not correct.');
        }
        self::checkNewPassword($new, $confirm);
        Db::run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $userId]);
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => time() - 42000, 'path' => $p['path'], 'httponly' => true, 'samesite' => 'Lax', 'secure' => $p['secure']]);
        }
        session_destroy();
    }

    private static function login(int $userId): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    private static function checkNewPassword(string $password, string $confirm): void
    {
        if (mb_strlen($password) < 10) {
            throw new BadInput('Use a password of at least 10 characters.');
        }
        if (!hash_equals($password, $confirm)) {
            throw new BadInput('The two passwords do not match.');
        }
    }
}
