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
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Range, Content-Type');
header('Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, Content-Type');
header('Access-Control-Max-Age: 86400');
header('Cache-Control: private, no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function fail_json(int $status, string $error): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $error]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    fail_json(405, 'method_not_allowed');
}

$basePath   = '/home/gyu5la0fbzjq/private/data';
$configFile = $basePath . '/config.php';
if (!file_exists($configFile)) fail_json(500, 'server_config_missing');
$config = require $configFile;
$firebaseApiKey = trim((string)($config['firebase_api_key'] ?? ''));
if ($firebaseApiKey === '') fail_json(500, 'firebase_config_missing');

// Require a valid Womo Firebase session so this endpoint cannot become a public proxy.
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
    fail_json(401, 'missing_auth_token');
}
$idToken = trim($matches[1]);
if ($idToken === '') fail_json(401, 'missing_auth_token');

$firebaseUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' . urlencode($firebaseApiKey);
$payload = json_encode(['idToken' => $idToken]);
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
$firebaseData = json_decode($firebaseResponse, true);
if ($firebaseStatus !== 200 || !is_array($firebaseData) || empty($firebaseData['users'][0]['localId'])) {
    fail_json(401, 'invalid_auth_token');
}

$source = trim((string)($_GET['url'] ?? ''));
if ($source === '') fail_json(400, 'missing_url');

function is_allowed_archive_url(string $url): bool
{
    $parts = parse_url($url);
    if (!is_array($parts)) return false;
    if (($parts['scheme'] ?? '') !== 'https') return false;
    $host = strtolower((string)($parts['host'] ?? ''));
    if ($host === 'archive.org') return true;
    if ($host === 'www.archive.org') return true;
    // Internet Archive download hosts such as ia600100.us.archive.org.
    if (str_ends_with($host, '.archive.org')) return true;
    return false;
}

if (!is_allowed_archive_url($source)) {
    fail_json(400, 'unsupported_media_host');
}

// Only proxy WMO objects. Query strings are allowed, but the path must end in .wmo.
$sourcePath = (string)(parse_url($source, PHP_URL_PATH) ?? '');
if (!preg_match('/\.wmo$/i', $sourcePath)) {
    fail_json(400, 'unsupported_media_type');
}

$range = trim((string)($_SERVER['HTTP_RANGE'] ?? ''));
if ($range !== '' && !preg_match('/^bytes=\d+-\d*$/', $range)) {
    fail_json(416, 'invalid_range');
}

function request_archive(string $url, string $range, int $redirects = 0): never
{
    if ($redirects > 5) fail_json(502, 'too_many_redirects');
    if (!is_allowed_archive_url($url)) fail_json(502, 'redirect_host_blocked');

    $headers = [];
    if ($range !== '') $headers[] = 'Range: ' . $range;
    $headers[] = 'Accept: application/octet-stream,*/*;q=0.8';
    $headers[] = 'User-Agent: WomoMediaBridge/1.0';

    $responseHeaders = [];
    $status = 0;
    $location = '';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 0,
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
        CURLOPT_WRITEFUNCTION => function ($curl, string $data): int {
            echo $data;
            if (function_exists('fastcgi_finish_request')) {
                // Do not finish early; streaming continues through echo.
            }
            flush();
            return strlen($data);
        }
    ]);

    // First request headers are not known until transfer starts. Buffer body only for redirects.
    ob_start();
    $ok = curl_exec($ch);
    $curlError = curl_error($ch);
    $curlStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $body = ob_get_clean();

    if ($ok === false) fail_json(502, 'archive_request_failed');
    if ($status === 0) $status = $curlStatus;

    if (in_array($status, [301, 302, 303, 307, 308], true) && $location !== '') {
        $next = $location;
        if (!preg_match('#^https://#i', $next)) {
            $base = parse_url($url);
            if (!is_array($base) || empty($base['host'])) fail_json(502, 'invalid_redirect');
            if (str_starts_with($next, '/')) {
                $next = 'https://' . $base['host'] . $next;
            } else {
                $dir = rtrim(dirname((string)($base['path'] ?? '/')), '/');
                $next = 'https://' . $base['host'] . $dir . '/' . $next;
            }
        }
        request_archive($next, $range, $redirects + 1);
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
