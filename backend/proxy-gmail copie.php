<?php
// tout en haut du fichier, juste après l'ouverture PHP :
ini_set('zlib.output_compression', '0');

// Proxy amélioré pour Node backend
// $API_BASE = 'https://gmail.jobiizy.com';
$API_BASE = 'https://gmail-sveltekit-backend.onrender.com';

// CORS : n'autoriser que https://gmail.jobiizy.com
header('Access-Control-Allow-Origin: https://gmail.jobiizy.com');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin, Cookie, Set-Cookie');

// Réponse aux préflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Récupérer le chemin de routage (PATH_INFO ou ?p=...)
$path = '';
if (!empty($_SERVER['PATH_INFO'])) {
    $path = $_SERVER['PATH_INFO'];
} elseif (isset($_GET['p'])) {
    $path = $_GET['p'];
}
$path = ltrim($path, '/');

// Reconstituer l'URL cible
$query = $_SERVER['QUERY_STRING'] ?? '';
// Retirer "p=..." de la query si utilisé pour le path
if (isset($_GET['p'])) {
    // Remove only first p=... occurrence
    $query = preg_replace('/(^|&)?p=[^&]*/', '', $query, 1);
    $query = ltrim($query, '&');
}
$url = rtrim($API_BASE, '/') . '/' . $path;
if ($query) {
    $url .= '?' . $query;
}

// Préparer cURL
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_HEADER, true); // Pour parser headers/réponse
curl_setopt($ch, CURLOPT_USERAGENT, $_SERVER['HTTP_USER_AGENT'] ?? 'PHP Proxy');
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
curl_setopt($ch, CURLOPT_TIMEOUT, 45);
// Demande à cURL de gérer automatiquement gzip/deflate/br et de renvoyer le corps DÉCOMPRESSÉ
curl_setopt($ch, CURLOPT_ENCODING, '');


// Transfert des headers (sauf à ignorer)
$ignored = ['host', 'content-length'];
$headers = [];
foreach (getallheaders() as $k => $v) {
    if (!in_array(strtolower($k), $ignored)) {
        $headers[] = "$k: $v";
    }
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

// Cookies
// if (isset($_SERVER['HTTP_COOKIE'])) {
//     curl_setopt($ch, CURLOPT_COOKIE, $_SERVER['HTTP_COOKIE']);
// }
if (!empty($_SERVER['HTTP_COOKIE'])) {
    curl_setopt($ch, CURLOPT_COOKIE, $_SERVER['HTTP_COOKIE']);
}

// Transfert du body
$methods_with_body = ['POST', 'PUT', 'PATCH', 'DELETE'];
if (in_array($_SERVER['REQUEST_METHOD'], $methods_with_body)) {
    $input = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

// Exécution
$resp = curl_exec($ch);
if ($resp === false) {
    $err = curl_error($ch);
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'proxy_error' => $err, 'to' => $url], JSON_UNESCAPED_UNICODE);
    curl_close($ch);
    exit;
}

$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$raw_headers = substr($resp, 0, $header_size);
$body = substr($resp, $header_size);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// Transférer les headers utiles (Content-Type, Set-Cookie, etc.)
$lines = preg_split('/\r\n|\n|\r/', $raw_headers);
foreach ($lines as $line) {
    $line = trim($line);
    if ($line === '') continue;

    // Ne pas forwarder la ligne de statut HTTP d'upstream
    if (stripos($line, 'HTTP/') === 0) continue;

    // Éviter d'envoyer des entêtes devenues invalides après décompression
    if (preg_match('#^(Content-Encoding|Content-Length|Transfer-Encoding|Connection|Keep-Alive):#i', $line)) continue;

    if (stripos($line, 'Set-Cookie:') === 0) {
        // Autoriser plusieurs Set-Cookie
        header($line, false);
        continue;
    }

    // Content-Type et autres headers "safe"
    header($line, true);
}

http_response_code($http_code);
echo $body;
curl_close($ch);
?>