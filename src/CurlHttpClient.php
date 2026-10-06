<?php

declare(strict_types=1);

namespace StudyApp;

use GuzzleHttp\Psr7\Response;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Client\NetworkExceptionInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Minimal PSR-18 client on top of cURL, used as the Anthropic SDK's transport.
 *
 * On Windows it also trusts the operating system's certificate store, so HTTPS
 * keeps working when antivirus software (e.g. Norton Web Shield) re-signs TLS
 * traffic with a root that PHP's bundled cacert.pem does not contain.
 * Set CA_BUNDLE in .env to point cURL at a specific CA file instead.
 */
final class CurlHttpClient implements ClientInterface
{
    public function __construct(private int $timeoutSeconds = 600)
    {
    }

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $headers = ['Expect:'];
        foreach ($request->getHeaders() as $name => $values) {
            $headers[] = $name . ': ' . implode(', ', $values);
        }

        $responseHeaders = [];
        $ch = curl_init((string) $request->getUri());
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $request->getMethod(),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 20,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$responseHeaders): int {
                $trimmed = trim($line);
                if (str_starts_with($trimmed, 'HTTP/')) {
                    $responseHeaders = []; // a new response (after 100-continue or a redirect)
                } elseif (str_contains($trimmed, ':')) {
                    [$k, $v] = explode(':', $trimmed, 2);
                    $responseHeaders[trim($k)][] = trim($v);
                }
                return strlen($line);
            },
        ]);

        $body = (string) $request->getBody();
        if ($body !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $caBundle = Config::get('CA_BUNDLE');
        if ($caBundle !== '') {
            curl_setopt($ch, CURLOPT_CAINFO, $caBundle);
        }
        if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
            curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
        }

        $result = curl_exec($ch);
        if ($result === false) {
            $message = curl_error($ch);
            curl_close($ch);
            throw new class ($message, $request) extends \RuntimeException implements NetworkExceptionInterface {
                public function __construct(string $message, private RequestInterface $request)
                {
                    parent::__construct($message);
                }

                public function getRequest(): RequestInterface
                {
                    return $this->request;
                }
            };
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return new Response($status, $responseHeaders, (string) $result);
    }
}
