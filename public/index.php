<?php

declare(strict_types=1);

use StudyApp\Auth;

require dirname(__DIR__) . '/src/bootstrap.php';

send_security_headers();
start_session();

$user = Auth::user();
if ($user === null) {
    header('Location: login.php');
    exit;
}

$nav = [
    ['Study', [
        ['queue', 'Review queue', 'pending'],
        ['library', 'Library', 'library'],
        ['flashcards', 'Flashcards', 'due'],
        ['quiz', 'Quick quiz', null],
        ['session', 'Study session', null],
        ['dashboard', 'Understanding', null],
    ]],
    ['Material', [
        ['guides', 'Guides & summaries', null],
        ['sources', 'Sources', 'sources'],
        ['add', 'Add notes', null],
    ]],
];
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="csrf-token" content="<?= e(csrf_token()) ?>">
    <title>Living Study Guide</title>
    <link rel="icon" href="<?= e(asset('assets/icon.svg')) ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= e(asset('assets/app.css')) ?>">
    <script type="module" src="<?= e(asset('assets/js/main.js')) ?>"></script>
</head>
<body>
<div class="app">
    <header class="topbar">
        <button class="icon-btn nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
        </button>
        <a class="brand" href="#/queue"><img src="<?= e(asset('assets/icon.svg')) ?>" alt="" width="22" height="22"><span>Living Study Guide</span></a>
    </header>

    <nav class="sidebar" id="sidebar" aria-label="Main">
        <a class="brand sidebar-brand" href="#/queue"><img src="<?= e(asset('assets/icon.svg')) ?>" alt="" width="24" height="24"><span>Living Study Guide</span></a>
        <?php foreach ($nav as [$group, $links]): ?>
            <div class="nav-group">
                <div class="nav-heading"><?= e($group) ?></div>
                <?php foreach ($links as [$route, $label, $count]): ?>
                    <a class="nav-link" href="#/<?= e($route) ?>" data-route="<?= e($route) ?>">
                        <span><?= e($label) ?></span>
                        <?php if ($count !== null): ?><span class="nav-count" data-count="<?= e($count) ?>"></span><?php endif; ?>
                    </a>
                <?php endforeach; ?>
            </div>
        <?php endforeach; ?>
        <div class="nav-foot">
            <a class="nav-link" href="#/settings" data-route="settings"><span>Settings &amp; backup</span></a>
            <div class="nav-user">
                <span class="muted" title="Signed in"><?= e($user['username']) ?></span>
                <form method="post" action="logout.php">
                    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                    <button class="link-btn" type="submit">Sign out</button>
                </form>
            </div>
        </div>
    </nav>
    <div class="scrim" hidden></div>

    <main class="main" id="main" tabindex="-1">
        <div class="loading">Loading…</div>
    </main>
</div>
<div class="toasts" aria-live="polite"></div>
</body>
</html>
