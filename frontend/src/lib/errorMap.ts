/**
 * Translate raw yt-dlp / backend error strings into a structured, user-friendly diagnosis.
 *
 * yt-dlp errors are technical — we surface them as a short title + a hint the user can act on,
 * and a flag indicating whether retrying with browser cookies is likely to fix the problem.
 */

export type ErrorCode =
    | 'age_restricted'
    | 'private'
    | 'members_only'
    | 'geo_blocked'
    | 'unavailable'
    | 'rate_limited'
    | 'forbidden'
    | 'network'
    | 'timeout'
    | 'extractor'
    | 'no_formats'
    | 'cookies_locked'
    | 'cookies_decrypt'
    | 'cookies_missing'
    | 'cancelled'
    | 'unknown';

export interface ParsedError {
    code: ErrorCode;
    title: string;
    hint: string;
    canRetryWithCookies: boolean;
    raw: string;
}

const PATTERNS: Array<{ test: RegExp; code: ErrorCode; title: string; hint: string; canRetryWithCookies?: boolean }> = [
    // Cookies extraction failures must be matched BEFORE any "retry with cookies" patterns,
    // otherwise yt-dlp's cookie-DB errors get bucketed as "use cookies" and create a loop.
    //
    // ORDER MATTERS: yt-dlp uses the same wording ("Could not copy Chrome cookie database")
    // for two very different problems — a real Windows file lock AND the Chrome 127+
    // app-bound encryption bug. The decrypt case links to issue 7271; we match that
    // signal first so users get the right hint (switch browser, not "close browser").
    {
        test: /yt-dlp\/yt-dlp\/issues\/7271|failed to decrypt with dpapi|failed to decrypt cookie|app[- ]?bound encryption|could not decrypt the cookie/i,
        code: 'cookies_decrypt',
        title: 'Cookies de Chrome cifradas — no se pueden leer',
        hint: 'Chrome 127+ usa cifrado app-bound que yt-dlp aún no puede descifrar. Cambia a Firefox o Edge en Ajustes de cookies (con sesión iniciada en YouTube en ese navegador).',
    },
    {
        test: /WinError 32|being used by another process|cookies? database is locked|permission denied.*cookies/i,
        code: 'cookies_locked',
        title: 'No se pudo leer las cookies del navegador',
        hint: 'Cierra completamente el navegador seleccionado (incluido el icono de la bandeja) y reintenta. Su base de datos de cookies queda bloqueada mientras está abierto.',
    },
    {
        test: /could not find .* cookies? database|unable to find .* cookies? database|no .* cookies database found|profile .* not found/i,
        code: 'cookies_missing',
        title: 'No se encontró la base de cookies',
        hint: 'El navegador seleccionado no tiene perfil instalado en este equipo. Elige otro navegador en Ajustes.',
    },
    {
        test: /sign in to confirm your age|confirm your age|inappropriate for some users/i,
        code: 'age_restricted',
        title: 'Video con restricción de edad',
        hint: 'YouTube exige sesión iniciada. Activa “Cookies del navegador” en Ajustes y reintenta.',
        canRetryWithCookies: true,
    },
    {
        test: /members[- ]only|join this channel|exclusive to channel members/i,
        code: 'members_only',
        title: 'Solo para miembros del canal',
        hint: 'Inicia sesión en YouTube como miembro del canal y reintenta con cookies activadas.',
        canRetryWithCookies: true,
    },
    {
        test: /private video|is a private video|requires sign in/i,
        code: 'private',
        title: 'Video privado',
        hint: 'Si tienes acceso, inicia sesión en YouTube y reintenta con cookies activadas.',
        canRetryWithCookies: true,
    },
    {
        test: /not available in your country|not available from your location|geo[- ]?restrict|blocked in your country/i,
        code: 'geo_blocked',
        title: 'Bloqueado en tu región',
        hint: 'Este contenido no está disponible desde tu ubicación. Una VPN podría ayudar.',
    },
    {
        test: /video unavailable|has been removed|content isn'?t available|content is not available|removed by the uploader/i,
        code: 'unavailable',
        title: 'Video no disponible',
        hint: 'El video fue eliminado o ya no se puede ver.',
    },
    {
        test: /HTTP Error 429|rate[- ]?limit|too many requests/i,
        code: 'rate_limited',
        title: 'Demasiadas solicitudes',
        hint: 'YouTube está limitando peticiones. Espera unos minutos y reintenta.',
    },
    {
        test: /HTTP Error 403|Access denied|forbidden/i,
        code: 'forbidden',
        title: 'Acceso bloqueado',
        hint: 'El servidor rechazó la descarga. Intenta con cookies activadas.',
        canRetryWithCookies: true,
    },
    {
        test: /could not resolve host|name or service not known|getaddrinfo|network is unreachable|connection refused/i,
        code: 'network',
        title: 'Sin conexión',
        hint: 'No se pudo contactar el servidor. Revisa tu conexión a internet.',
    },
    {
        test: /read operation timed out|timed out|timeout|connection reset by peer|incomplete read/i,
        code: 'timeout',
        title: 'Tiempo de espera agotado',
        hint: 'La conexión se interrumpió durante la descarga. Reintenta — el reintento ahora retoma desde fragmentos limpios.',
    },
    {
        test: /unable to extract|extractor failed|unsupported url/i,
        code: 'extractor',
        title: 'Plataforma no soportada',
        hint: 'Esta URL no se puede procesar. Verifica que el enlace sea válido.',
    },
    {
        test: /requested format is not available|no video formats found|no.*formats.*found|format selector returned no formats/i,
        code: 'no_formats',
        title: 'YouTube no devolvió formatos descargables',
        hint: 'Antibloqueo de YouTube. La app reintenta con clientes alternativos automáticamente; si vuelve a fallar, asegúrate de que la extensión Companion esté sincronizando cookies frescas y reintenta.',
    },
    {
        test: /cancelled by user|cancelled/i,
        code: 'cancelled',
        title: 'Cancelado',
        hint: 'La operación fue cancelada manualmente.',
    },
];

export function parseError(raw: string | null | undefined): ParsedError {
    const text = (raw || '').trim();
    if (!text) {
        return {
            code: 'unknown',
            title: 'Error desconocido',
            hint: 'Inténtalo de nuevo en un momento.',
            canRetryWithCookies: false,
            raw: '',
        };
    }

    for (const pattern of PATTERNS) {
        if (pattern.test.test(text)) {
            return {
                code: pattern.code,
                title: pattern.title,
                hint: pattern.hint,
                canRetryWithCookies: !!pattern.canRetryWithCookies,
                raw: text,
            };
        }
    }

    // Fallback: take the first useful line (skip "ERROR:" prefix yt-dlp adds)
    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) || text;
    const cleaned = firstLine.replace(/^ERROR:\s*\[[^\]]+\]\s*[a-zA-Z0-9_-]+:\s*/i, '').replace(/^ERROR:\s*/i, '');

    return {
        code: 'unknown',
        title: 'No se pudo descargar',
        hint: cleaned.length > 220 ? cleaned.slice(0, 220) + '…' : cleaned,
        // Unknown errors do NOT default to "retry with cookies": cookies fix specific
        // auth/age/forbidden cases, not arbitrary failures. Showing the button by default
        // produced loops where cookie-extraction errors offered to retry with cookies.
        canRetryWithCookies: false,
        raw: text,
    };
}
