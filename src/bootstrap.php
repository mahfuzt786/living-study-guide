<?php

declare(strict_types=1);

use StudyApp\Config;

define('APP_ROOT', dirname(__DIR__));

$autoload = APP_ROOT . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    exit('Dependencies are missing. Run "composer install" in ' . APP_ROOT);
}
require $autoload;

Config::load(APP_ROOT . '/.env');
date_default_timezone_set('UTC');

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    header('Cache-Control: no-store');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    // The path is "/" because the same pages are reachable as /study-app/ (rewritten into
    // public/) and as /study-app/public/; the cookie name is unique to this app.
    session_name('living_study_guide');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => is_https(),
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function csrf_token(): string
{
    return $_SESSION['csrf'] ?? '';
}

function csrf_valid(?string $token): bool
{
    return is_string($token) && csrf_token() !== '' && hash_equals(csrf_token(), $token);
}

function now_iso(int $offsetSeconds = 0): string
{
    return gmdate('Y-m-d\TH:i:s\Z', time() + $offsetSeconds);
}

function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Cache-busting version for a static asset under public/. */
function asset(string $path): string
{
    $file = APP_ROOT . '/public/' . $path;
    return $path . (is_file($file) ? '?v=' . filemtime($file) : '');
}
