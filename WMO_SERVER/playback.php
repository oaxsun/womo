<?php

declare(strict_types=1);

$allowedOrigins = [
    'https://womo.oaxsun.tech'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function b64url(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$basePath   = '/home/gyu5la0fbzjq/private/data';
$configFile = $basePath . '/config.php';
$dbFile     = $basePath . '/media.db';

if (!file_exists($configFile)) respond(500, ['ok' => false, 'error' => 'server_config_missing']);
if (!file_exists($dbFile)) respond(500, ['ok' => false, 'error' => 'database_missing']);

$config = require $configFile;
$firebaseApiKey = trim((string)($config['firebase_api_key'] ?? ''));
$mediaSecret = trim((string)($config['register_token'] ?? ''));
if ($firebaseApiKey === '') respond(500, ['ok' => false, 'error' => 'firebase_config_missing']);
if ($mediaSecret === '') respond(500, ['ok' => false, 'error' => 'media_secret_missing']);

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
    respond(401, ['ok' => false, 'error' => 'missing_auth_token']);
}
$idToken = trim($matches[1]);
if ($idToken === '') respond(401, ['ok' => false, 'error' => 'missing_auth_token']);

$firebaseUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' . urlencode($firebaseApiKey);
$payload = json_encode(['idToken' => $idToken]);
$ch = curl_init($firebaseUrl);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 10
]);
$firebaseResponse = curl_exec($ch);
if ($firebaseResponse === false) {
    curl_close($ch);
    respond(503, ['ok' => false, 'error' => 'firebase_unavailable']);
}
$firebaseStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$firebaseData = json_decode($firebaseResponse, true);
if ($firebaseStatus !== 200 || !is_array($firebaseData) || empty($firebaseData['users'][0]['localId'])) {
    respond(401, ['ok' => false, 'error' => 'invalid_auth_token']);
}
$uid = (string)$firebaseData['users'][0]['localId'];

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) respond(400, ['ok' => false, 'error' => 'invalid_json']);
$contentId = trim((string)($data['contentId'] ?? ''));
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $contentId)) {
    respond(400, ['ok' => false, 'error' => 'invalid_content_id']);
}

try {
    $pdo = new PDO('sqlite:' . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $stmt = $pdo->prepare('SELECT media_key FROM media_keys WHERE content_id = :content_id LIMIT 1');
    $stmt->execute([':content_id' => $contentId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) respond(404, ['ok' => false, 'error' => 'content_not_found']);

    // Short-lived bridge token. media.php can validate this locally, so every
    // 4-second media segment does not need another round-trip to Firebase Auth.
    $claims = [
        'uid' => $uid,
        'exp' => time() + 7200,
        'v' => 2
    ];
    $payloadPart = b64url((string)json_encode($claims));
    $signature = b64url(hash_hmac('sha256', $payloadPart, $mediaSecret, true));
    $mediaToken = 'wmo2.' . $payloadPart . '.' . $signature;

    respond(200, [
        'ok' => true,
        'contentId' => $contentId,
        'key' => $row['media_key'],
        'mediaToken' => $mediaToken,
        'expiresIn' => 7200
    ]);
} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => 'server_error']);
}
