<?php

declare(strict_types=1);

use StudyApp\Auth;
use StudyApp\BadInput;

require dirname(__DIR__) . '/src/bootstrap.php';

send_security_headers();
start_session();

if (Auth::user() !== null) {
    header('Location: ./');
    exit;
}

$setup = !Auth::hasOwner();
$error = '';
$username = '';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $username = (string) ($_POST['username'] ?? '');
    try {
        if (!csrf_valid($_POST['csrf'] ?? null)) {
            throw new BadInput('Your session expired. Please try again.');
        }
        if ($setup) {
            Auth::createOwner($username, (string) ($_POST['password'] ?? ''), (string) ($_POST['confirm'] ?? ''));
        } elseif (!Auth::attempt($username, (string) ($_POST['password'] ?? ''), $_SERVER['REMOTE_ADDR'] ?? 'unknown')) {
            throw new BadInput('That username and password do not match.');
        }
        header('Location: ./');
        exit;
    } catch (BadInput $e) {
        $error = $e->getMessage();
    }
}
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title><?= $setup ? 'Set up your study guide' : 'Sign in' ?> · Living Study Guide</title>
    <link rel="icon" href="<?= e(asset('assets/icon.svg')) ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= e(asset('assets/app.css')) ?>">
</head>
<body class="auth-page">
<main class="auth-card">
    <div class="brand brand-lg">
        <img src="<?= e(asset('assets/icon.svg')) ?>" alt="" width="28" height="28">
        <span>Living Study Guide</span>
    </div>
    <?php if ($setup): ?>
        <h1>Create your owner account</h1>
        <p class="muted">This guide is private. You are the only account, and every page sits behind this sign-in.</p>
    <?php else: ?>
        <h1>Sign in</h1>
        <p class="muted">Your notes and cards stay behind this sign-in.</p>
    <?php endif; ?>

    <?php if ($error !== ''): ?>
        <p class="form-error" role="alert"><?= e($error) ?></p>
    <?php endif; ?>

    <form method="post" class="stack">
        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
        <label class="field">
            <span>Username</span>
            <input name="username" autocomplete="username" required value="<?= e($username) ?>" autofocus>
        </label>
        <label class="field">
            <span>Password</span>
            <input name="password" type="password" autocomplete="<?= $setup ? 'new-password' : 'current-password' ?>" required <?= $setup ? 'minlength="10"' : '' ?>>
        </label>
        <?php if ($setup): ?>
            <label class="field">
                <span>Confirm password</span>
                <input name="confirm" type="password" autocomplete="new-password" required minlength="10">
            </label>
        <?php endif; ?>
        <button class="btn btn-primary btn-block" type="submit"><?= $setup ? 'Create account' : 'Sign in' ?></button>
    </form>
</main>
</body>
</html>
