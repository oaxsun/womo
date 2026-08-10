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
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Range');
header('Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, Content-Type');
header('Access-Control-Max-Age: 86400');
header('Cache-Control: private, no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function fail_json(int $status, string $error): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $error]);
    exit;
}

function b64url_decode_strict(string $value)
{
    $value = strtr($value, '-_', '+/');
    $pad = strlen($value) % 4;
    if ($pad) $value .= str_repeat('=', 4 - $pad);
    return base64_decode($value, true);
}

function is_allowed_archive_url(string $url): bool
{
    $parts = parse_url($url);
    if (!is_array($parts)) return false;
    if (($parts['scheme'] ?? '') !== 'https') return false;
    $host = strtolower((string)($parts['host'] ?? ''));
    if ($host === 'archive.org' || $host === 'www.archive.org') return true;
    return substr($host, -12) === '.archive.org';
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method !== 'POST' && $method !== 'GET') fail_json(405, 'method_not_allowed');

$basePath   = '/home/gyu5la0fbzjq/private/data';
$configFile = $basePath . '/config.php';
if (!file_exists($configFile)) fail_json(500, 'server_config_missing');
$config = require $configFile;
$firebaseApiKey = trim((string)($config['firebase_api_key'] ?? ''));
$mediaSecret = trim((string)($config['register_token'] ?? ''));
if ($firebaseApiKey === '') fail_json(500, 'firebase_config_missing');
if ($mediaSecret === '') fail_json(500, 'media_secret_missing');

$source = '';
$authToken = '';
$start = null;
$end = null;

if ($method === 'POST') {
    $data = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($data)) fail_json(400, 'invalid_json');
    $source = trim((string)($data['url'] ?? ''));
    $authToken = trim((string)($data['token'] ?? ''));
    if (isset($data['start'])) $start = (int)$data['start'];
    if (isset($data['end'])) $end = (int)$data['end'];
} else {
    $source = trim((string)($_GET['url'] ?? ''));
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) $authToken = trim($matches[1]);
    $rangeHeader = trim((string)($_SERVER['HTTP_RANGE'] ?? ''));
    if ($rangeHeader !== '' && preg_match('/^bytes=(\d+)-(\d*)$/', $rangeHeader, $m)) {
        $start = (int)$m[1];
        $end = $m[2] !== '' ? (int)$m[2] : null;
    }
}

if ($source === '') fail_json(400, 'missing_url');
if ($authToken === '') fail_json(401, 'missing_auth_token');
if ($start === null || $start < 0) fail_json(416, 'invalid_range');
if ($end !== null && $end < $start) fail_json(416, 'invalid_range');

$authorized = false;
if (strpos($authToken, 'wmo2.') === 0) {
    $parts = explode('.', $authToken);
    if (count($parts) === 3 && $parts[0] === 'wmo2') {
        $payloadPart = $parts[1];
        $signaturePart = $parts[2];
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payloadPart, $mediaSecret, true)), '+/', '-_'), '=');
        if (hash_equals($expected, $signaturePart)) {
            $payloadJson = b64url_decode_strict($payloadPart);
            $claims = $payloadJson !== false ? json_decode($payloadJson, true) : null;
            if (is_array($claims) && !empty($claims['uid']) && (int)($claims['exp'] ?? 0) >= time()) {
                $authorized = true;
            }
        }
    }
} else {
    $firebaseUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' . urlencode($firebaseApiKey);
    $payload = json_encode(['idToken' => $authToken]);
    $authCurl = curl_init($firebaseUrl);
    curl_setopt_array($authCurl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10
    ]);
    $firebaseResponse = curl_exec($authCurl);
    if ($firebaseResponse === false) {
        curl_close($authCurl);
        fail_json(503, 'firebase_unavailable');
    }
    $firebaseStatus = curl_getinfo($authCurl, CURLINFO_HTTP_CODE);
    curl_close($authCurl);
    $firebaseData = json_decode((string)$firebaseResponse, true);
    if ($firebaseStatus === 200 && is_array($firebaseData) && !empty($firebaseData['users'][0]['localId'])) {
        $authorized = true;
    }
}

if (!$authorized) fail_json(401, 'invalid_auth_token');
if (!is_allowed_archive_url($source)) fail_json(400, 'unsupported_media_host');
$sourcePath = (string)(parse_url($source, PHP_URL_PATH) ?? '');
if (!preg_match('/\.wmo$/i', $sourcePath)) fail_json(400, 'unsupported_media_type');

$range = 'bytes=' . $start . '-' . ($end === null ? '' : $end);

function request_archive(string $url, string $range, int $redirects = 0): void
{
    if ($redirects > 5) fail_json(502, 'too_many_redirects');
    if (!is_allowed_archive_url($url)) fail_json(502, 'redirect_host_blocked');

    $headers = [
        'Range: ' . $range,
        'Accept: application/octet-stream,*/*;q=0.8',
        'User-Agent: WomoMediaBridge/2.1'
    ];

    $responseHeaders = [];
    $status = 0;
    $location = '';
    $body = '';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HEADERFUNCTION => function ($curl, string $line) use (&$responseHeaders, &$status, &$location): int {
            $len = strlen($line);
            $trimmed = trim($line);
            if ($trimmed === '') return $len;
            if (preg_match('#^HTTP/\S+\s+(\d+)#i', $trimmed, $m)) {
                $status = (int)$m[1];
                $responseHeaders = [];
                $location = '';
                return $len;
            }
            $pos = strpos($trimmed, ':');
            if ($pos !== false) {
                $name = strtolower(trim(substr($trimmed, 0, $pos)));
                $value = trim(substr($trimmed, $pos + 1));
                $responseHeaders[$name] = $value;
                if ($name === 'location') $location = $value;
            }
            return $len;
        },
        CURLOPT_WRITEFUNCTION => function ($curl, string $data) use (&$body): int {
            $body .= $data;
            return strlen($data);
        }
    ]);

    $ok = curl_exec($ch);
    $curlStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($ok === false) fail_json(502, 'archive_request_failed');
    if ($status === 0) $status = $curlStatus;

    if (in_array($status, [301, 302, 303, 307, 308], true) && $location !== '') {
        $next = $location;
        if (!preg_match('#^https://#i', $next)) {
            $base = parse_url($url);
            if (!is_array($base) || empty($base['host'])) fail_json(502, 'invalid_redirect');
            if (strpos($next, '/') === 0) {
                $next = 'https://' . $base['host'] . $next;
            } else {
                $dir = rtrim(dirname((string)($base['path'] ?? '/')), '/');
                $next = 'https://' . $base['host'] . $dir . '/' . $next;
            }
        }
        request_archive($next, $range, $redirects + 1);
        return;
    }

    if ($status !== 200 && $status !== 206) {
        fail_json($status >= 400 && $status < 600 ? $status : 502, 'archive_http_' . $status);
    }

    http_response_code($status);
    header('Content-Type: ' . ($responseHeaders['content-type'] ?? 'application/octet-stream'));
    header('Accept-Ranges: bytes');
    if (isset($responseHeaders['content-range'])) header('Content-Range: ' . $responseHeaders['content-range']);
    if (isset($responseHeaders['content-length'])) header('Content-Length: ' . $responseHeaders['content-length']);
    if (isset($responseHeaders['etag'])) header('ETag: ' . $responseHeaders['etag']);
    echo $body;
    exit;
}

request_archive($source, $range);
