<?php
// --- Configuration du débogage ---
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/logs/proxy_error.log');
error_reporting(E_ALL);
ini_set('zlib.output_compression', '0');

// --- Gestion du dossier logs ---
$log_dir = __DIR__ . '/logs';
$log_file = $log_dir . '/proxy_error.log';
$access_log_file = $log_dir . '/proxy_access.log';
if (!is_dir($log_dir)) {
    @mkdir($log_dir, 0755, true);
}
if (!is_writable($log_dir)) {
    $log_dir = '/tmp';
    $log_file = $log_dir . '/proxy_error.log';
    $access_log_file = $log_dir . '/proxy_access.log';
    error_log("Fallback to /tmp logs: public_html/logs is not writable", 3, $log_file);
}
ini_set('error_log', $log_file);

// --- Config backend ---
$API_BASE = 'https://gmail-sveltekit-backend.onrender.com';

// --- Compat: getallheaders polyfill ---
if (!function_exists('getallheaders')) {
    function getallheaders() {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (strpos($name, 'HTTP_') === 0) {
                $key = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
                $headers[$key] = $value;
            } elseif (in_array($name, ['CONTENT_TYPE', 'CONTENT_LENGTH', 'CONTENT_MD5'])) {
                $key = str_replace('_', '-', ucwords(strtolower($name), '_'));
                $headers[$key] = $value;
            }
        }
        return $headers;
    }
}

// --- CORS ---
header('Access-Control-Allow-Origin: https://gmail.jobiizy.com');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cookie, Set-Cookie');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Détermination de l'action ---
$action = isset($_GET['action']) ? trim($_GET['action']) : '';
if ($action === '' && isset($_SERVER['PATH_INFO'])) {
    $action = ltrim($_SERVER['PATH_INFO'], '/');
}
if ($action === '' && isset($_SERVER['REQUEST_URI'])) {
    $reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    if ($script && strpos($reqPath, $script) === 0) {
        $action = ltrim(substr($reqPath, strlen($script)), '/');
    }
}

// --- Validation de l'action ---
if ($action === '' || $action === false || !preg_match('/^[a-zA-Z0-9_\/-]+$/', $action)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Invalid or missing action']);
    error_log("Invalid action: $action", 3, $log_file);
    exit;
}

// --- Construction de l’URL cible ---
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$target = rtrim($API_BASE, '/') . '/' . $action;
$qs = $_SERVER['QUERY_STRING'] ?? '';
if ($qs) {
    parse_str($qs, $q);
    unset($q['action']);
    foreach ($q as $key => $value) {
        if (!preg_match('/^[a-zA-Z0-9_-]+$/', $key) || is_array($value)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid query parameter']);
            error_log("Invalid query parameter: $key", 3, $log_file);
            exit;
        }
    }
    if (!empty($q)) {
        $target .= '?' . http_build_query($q);
    }
}

// --- Cache (optionnel, désactivé par défaut) ---
$use_cache = false;
$cache_file = __DIR__ . '/cache/' . md5($target) . '.cache';
if ($use_cache && $method === 'GET' && file_exists($cache_file) && (time() - filemtime($cache_file)) < 300) {
    header('Content-Type: application/json; charset=utf-8');
    echo file_get_contents($cache_file);
    exit;
}

// --- cURL vers le backend ---
$incomingHeaders = function_exists('getallheaders') ? getallheaders() : [];
$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 300);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

// --- Méthode et body ---
$rawBody = file_get_contents('php://input') ?: '';
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($rawBody !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
    }
} else {
    curl_setopt($ch, CURLOPT_HTTPGET, true);
}

// --- Headers ---
$hdrs = [];
$hasContentType = false;
foreach ($incomingHeaders as $k => $v) {
    $lk = strtolower($k);
    if (in_array($lk, ['host', 'content-length', 'connection', 'accept-encoding'])) continue;
    if ($lk === 'cookie') continue;
    if ($lk === 'content-type') {
        $hasContentType = true;
        $hdrs[] = $k . ': ' . $v;
        continue;
    }
    $hdrs[] = $k . ': ' . $v;
}
if ($rawBody && !$hasContentType) {
    $hdrs[] = 'Content-Type: application/json; charset=utf-8';
}
$hdrs[] = 'Expect:';
curl_setopt($ch, CURLOPT_HTTPHEADER, $hdrs);

// --- Cookies ---
if (!empty($_SERVER['HTTP_COOKIE'])) {
    curl_setopt($ch, CURLOPT_COOKIE, $_SERVER['HTTP_COOKIE']);
}

// --- Log de la requête ---
error_log("Proxy request: $method $target, Action: $action, Body: " . substr($rawBody, 0, 200) . ", Headers: " . json_encode($incomingHeaders), 3, $access_log_file);

// --- Exécution cURL ---
$resp = curl_exec($ch);
if ($resp === false) {
    $err = curl_error($ch);
    $errno = curl_errno($ch);
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'proxy_error' => $err, 'errno' => $errno, 'to' => $target]);
    error_log("Proxy error: $err (errno: $errno), Action: $action, Target: $target", 3, $log_file);
    curl_close($ch);
    exit;
}

// --- Découpe headers/body ---
$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$raw_headers = substr($resp, 0, $header_size);
$body = substr($resp, $header_size);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// --- Validation JSON conditionnelle ---
$resp_ct = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '';
$is_json = preg_match('#^application/json\\b#i', $resp_ct) === 1;

// Certaines actions ne renvoient jamais du JSON (callback OAuth, pages HTML)
$non_json_actions = [
    'oauth2callback',
    'show-report',    // selon ton implémentation, garder si HTML
    '_version'        // peut être JSON; enlève-le si tu préfères le valider
];
// on teste si $action est exactement l'un de ceux-là ou démarre par "show-report/"
$skip_json_check = false;
foreach ($non_json_actions as $na) {
    if ($action === $na || str_starts_with($action, $na . '/')) {
        $skip_json_check = true;
        break;
    }
}

if (!$skip_json_check && $http_code === 200 && $is_json) {
    $decoded = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok' => false,
            'error' => 'Invalid JSON response from backend',
            'to' => $target,
            'contentType' => $resp_ct
        ]);
        error_log("Invalid JSON response, Action: $action, Target: $target, Body: " . substr($body, 0, 200), 3, $log_file);
        curl_close($ch);
        exit;
    }
}
// sinon : si ce n'est pas du JSON (HTML, redirect…), on ne vérifie pas

// --- Gestion des erreurs OAuth (ex. 401, 403) ---
if (in_array($http_code, [401, 403])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Authentication error from backend', 'http_code' => $http_code, 'to' => $target]);
    error_log("Authentication error, HTTP $http_code, Action: $action, Target: $target, Body: " . substr($body, 0, 200), 3, $log_file);
    curl_close($ch);
    exit;
}

// --- Log de la réponse ---
error_log("Proxy response: HTTP $http_code, Action: $action, Body: " . substr($body, 0, 200), 3, $access_log_file);

// --- Cache (si activé) ---
if ($use_cache && $method === 'GET' && $http_code === 200) {
    $cache_dir = __DIR__ . '/cache';
    if (!is_dir($cache_dir)) mkdir($cache_dir, 0755, true);
    if (is_writable($cache_dir)) {
        file_put_contents($cache_file, $body);
    }
}

// --- Relais des headers ---
if (empty($raw_headers)) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'No headers received from backend', 'to' => $target]);
    error_log("No headers received, Action: $action, Target: $target", 3, $log_file);
    curl_close($ch);
    exit;
}
$lines = preg_split("/\r\n|\n|\r/", $raw_headers);
foreach ($lines as $line) {
    $line = trim($line);
    if ($line === '' || stripos($line, 'HTTP/') === 0) continue;
    if (preg_match('#^(Content-Encoding|Content-Length|Transfer-Encoding|Connection|Keep-Alive):#i', $line)) continue;
    if (stripos($line, 'Set-Cookie:') === 0) {
        header($line, false);
        continue;
    }
    header($line, true);
}

// --- Envoi de la réponse ---
http_response_code($http_code);
echo $body;
curl_close($ch);
?>