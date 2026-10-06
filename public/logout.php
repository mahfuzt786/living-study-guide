<?php

declare(strict_types=1);

use StudyApp\Auth;

require dirname(__DIR__) . '/src/bootstrap.php';

send_security_headers();
start_session();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' && csrf_valid($_POST['csrf'] ?? null)) {
    Auth::logout();
}
header('Location: login.php');
