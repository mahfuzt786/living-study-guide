<?php

declare(strict_types=1);

namespace StudyApp;

/**
 * Reads settings from real environment variables first (e.g. Replit Secrets),
 * then from the project's .env file.
 */
final class Config
{
    /** @var array<string, string> */
    private static array $file = [];

    public static function load(string $envFile): void
    {
        if (!is_file($envFile)) {
            return;
        }
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = array_map('trim', explode('=', $line, 2));
            if (preg_match('/^(["\'])(.*)\1$/', $value, $m)) {
                $value = $m[2];
            }
            self::$file[$key] = $value;
        }
    }

    public static function get(string $key, string $default = ''): string
    {
        $env = getenv($key);
        if (is_string($env) && $env !== '') {
            return $env;
        }
        return self::$file[$key] ?? $default;
    }

    public static function dataDir(): string
    {
        return rtrim(self::get('STUDY_DATA_DIR', APP_ROOT . '/data'), '/\\');
    }

    public static function apiKey(): string
    {
        return self::get('ANTHROPIC_API_KEY');
    }

    // App-specific names, so variables set by other tools (e.g. a CLAUDE_EFFORT or
    // ANTHROPIC_BASE_URL exported in a developer's shell) cannot change the app's behaviour.
    public static function model(): string
    {
        return self::get('STUDY_MODEL', 'claude-opus-5-5');
    }

    public static function effort(): string
    {
        $effort = self::get('STUDY_EFFORT', 'medium');
        return in_array($effort, ['low', 'medium', 'high', 'xhigh', 'max'], true) ? $effort : 'medium';
    }

    public static function apiBaseUrl(): string
    {
        return self::get('STUDY_ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    }

    public static function claudeAvailable(): bool
    {
        return self::apiKey() !== '';
    }
}
