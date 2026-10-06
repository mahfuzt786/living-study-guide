<?php

declare(strict_types=1);

use StudyApp\Auth;
use StudyApp\Backup;
use StudyApp\BadInput;
use StudyApp\Config;
use StudyApp\Dashboard;
use StudyApp\Db;
use StudyApp\ExtractionError;
use StudyApp\Items;
use StudyApp\NotFound;
use StudyApp\Sources;
use StudyApp\Study;

require dirname(__DIR__) . '/src/bootstrap.php';

send_security_headers();
start_session();

function respond(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(string $message, int $status = 400, array $extra = []): never
{
    respond(['error' => $message] + $extra, $status);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');
$user = Auth::user();
if ($user === null) {
    fail('Please sign in.', 401);
}

$body = [];
if ($method === 'POST') {
    if (!csrf_valid($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
        fail('Your session expired. Reload the page.', 403);
    }
    $raw = file_get_contents('php://input') ?: '';
    $body = $raw === '' ? [] : json_decode($raw, true);
    if (!is_array($body)) {
        fail('The request body was not valid JSON.');
    }
}
// The API never changes the session, and releasing its lock lets other requests run
// while a long Claude extraction is in progress.
session_write_close();

$get = fn (string $key, mixed $default = null) => $body[$key] ?? $_GET[$key] ?? $default;
$id = fn (string $key = 'id') => (int) $get($key, 0);

/** Routes: "METHOD action" => handler. */
$routes = [
    'GET state' => fn () => [
        'user' => $user['username'],
        'counts' => [
            'pending' => (int) Db::value("SELECT COUNT(*) FROM items WHERE status = 'pending'"),
            'library' => (int) Db::value("SELECT COUNT(*) FROM items WHERE status = 'approved'"),
            'due' => (int) Db::value("SELECT COUNT(*) FROM items WHERE status = 'approved' AND kind <> 'question' AND card_front <> '' AND card_back <> '' AND (due_at IS NULL OR due_at <= ?)", [now_iso()]),
            'sources' => (int) Db::value('SELECT COUNT(*) FROM sources'),
        ],
        'ai' => [
            'claude' => Config::claudeAvailable(),
            'model' => Config::model(),
            'effort' => Config::effort(),
        ],
        'goal' => ['subject' => Db::setting('goal_subject'), 'focus' => Db::setting('goal_focus')],
    ],

    'GET sources' => fn () => Sources::all(),
    'GET source' => fn () => Sources::show($id()),
    'POST source.create' => fn () => Sources::create((string) $get('title', ''), (string) $get('topic', ''), (string) $get('content', '')),
    'POST source.demo' => fn () => Sources::loadDemo(),
    'POST source.extract' => fn () => Sources::extractChunk($id(), (int) $get('chunk', 0), (string) $get('mode', 'local')),
    'POST source.delete' => function () use ($id) {
        Sources::delete($id());
        return ['ok' => true];
    },

    'GET queue' => fn () => Items::search(['status' => 'pending', 'source_id' => $get('source_id'), 'sort' => 'source', 'context' => true, 'limit' => 500]),
    'GET items' => fn () => Items::search([
        'status' => $get('status', 'approved'),
        'q' => $get('q', ''),
        'kind' => $get('kind'),
        'tag' => $get('tag'),
        'source_id' => $get('source_id'),
        'sort' => $get('sort'),
    ]),
    'GET item' => fn () => Items::show($id()),
    'GET tags' => fn () => Items::tags(),
    'POST item.create' => fn () => Items::createManual($id('source_id'), (string) $get('excerpt', ''), (array) $get('fields', [])),
    'POST item.update' => fn () => Items::update($id(), (array) $get('fields', [])),
    'POST item.approve' => fn () => Items::approve($id(), is_array($get('fields')) ? $get('fields') : null),
    'POST item.discard' => fn () => Items::discard($id()),
    'POST item.restore' => fn () => Items::restore($id()),
    'POST item.merge' => fn () => Items::merge($id(), $id('into')),

    'GET study.deck' => fn () => Study::deck([
        'kind' => $get('kind'), 'tag' => $get('tag'), 'source_id' => $get('source_id'),
        'due_only' => $get('due_only') === '1', 'size' => $get('size', 20),
    ]),
    'GET study.quiz' => fn () => Study::quiz(['kind' => $get('kind'), 'tag' => $get('tag'), 'source_id' => $get('source_id'), 'size' => $get('size', 8)]),
    'POST study.grade' => fn () => Items::grade($id(), (string) $get('result', ''), (string) $get('mode', 'flashcard')),

    'GET dashboard' => fn () => Dashboard::build(),

    'POST settings.goal' => function () use ($get) {
        Db::setSetting('goal_subject', mb_substr(trim((string) $get('subject', '')), 0, 200));
        Db::setSetting('goal_focus', mb_substr(trim((string) $get('focus', '')), 0, 100));
        return ['ok' => true, 'goal' => Sources::goal()];
    },
    'POST settings.password' => function () use ($get, $user) {
        Auth::changePassword((int) $user['id'], (string) $get('current', ''), (string) $get('new', ''), (string) $get('confirm', ''));
        return ['ok' => true];
    },

    'GET backup' => function () {
        header('Content-Disposition: attachment; filename="study-guide-backup-' . gmdate('Y-m-d') . '.json"');
        respond(Backup::export());
    },
    'GET export.md' => function () {
        header('Content-Type: text/markdown; charset=utf-8');
        header('Content-Disposition: attachment; filename="study-guide-' . gmdate('Y-m-d') . '.md"');
        echo Backup::markdown();
        exit;
    },
    'POST restore' => fn () => Backup::import(is_array($get('backup')) ? $get('backup') : []),
];

$handler = $routes["$method $action"] ?? null;
if ($handler === null) {
    fail('Unknown action.', 404);
}

try {
    respond($handler());
} catch (BadInput $e) {
    fail($e->getMessage(), 422);
} catch (NotFound $e) {
    fail($e->getMessage(), 404);
} catch (ExtractionError $e) {
    fail($e->getMessage(), 502, ['retryable' => $e->retryable]);
} catch (Throwable $e) {
    error_log('[study-app] ' . $e);
    fail('Something went wrong on the server. Details were written to the PHP error log.', 500);
}
