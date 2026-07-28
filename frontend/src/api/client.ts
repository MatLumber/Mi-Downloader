/**
 * Base URL of the local engine.
 *
 * The engine binds the first free port from 8765 upward and reports it to
 * Electron, which pushes it here at boot. 8765 is only the initial guess, used
 * before the handshake lands and in a plain browser (`npm run dev` without
 * Electron).
 */
const DEFAULT_API_BASE = 'http://127.0.0.1:8765';

let apiBase = DEFAULT_API_BASE;

export function getApiBase(): string {
    return apiBase;
}

export function setApiBase(baseUrl: string | null | undefined): void {
    if (baseUrl && /^https?:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
        apiBase = baseUrl;
    }
}

/**
 * Wall-clock budgets, in ms.
 *
 * `INFO` is the one that mattered: yt-dlp extraction routinely needs 15-60s
 * (cold DNS, nsig JS interpretation, per-client retries when YouTube rejects
 * the first player client), but the client aborted at 10s and surfaced the raw
 * DOMException text — the "signal timed out" toast. The engine now enforces its
 * own 75s deadline and returns a real 504, so the client budget just has to sit
 * above it.
 */
const TIMEOUTS = {
    health: 4_000,
    info: 90_000,
    quick: 15_000,
    mutate: 30_000,
} as const;

/**
 * Turn transport-level failures into messages a user can act on.
 *
 * `AbortSignal.timeout()` rejects with a TimeoutError DOMException whose
 * message is the untranslated string "signal timed out"; a dead engine gives
 * "Failed to fetch". Neither is something to show a person.
 */
function toFriendlyError(error: unknown, action: string): Error {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return new Error(
            `${action} tardó demasiado y se canceló. La plataforma está lenta o bloqueando la petición; reintenta en unos segundos.`
        );
    }
    if (error instanceof TypeError) {
        return new Error(
            'No hay conexión con el motor de GravityDown. Espera unos segundos a que arranque o reinícialo desde Ajustes.'
        );
    }
    return error instanceof Error ? error : new Error(String(error));
}

/** Read the `detail` field FastAPI puts on errors, falling back to the status. */
async function readErrorDetail(response: Response, fallback: string): Promise<string> {
    try {
        const body = await response.json();
        if (body && typeof body.detail === 'string' && body.detail) return body.detail;
    } catch {
        // Non-JSON body (proxy error page, truncated response) — use the fallback.
    }
    return `${fallback} (HTTP ${response.status})`;
}

interface ApiFetchOptions extends RequestInit {
    timeoutMs?: number;
    action?: string;
    fallbackError?: string;
}

async function apiFetch(pathname: string, options: ApiFetchOptions = {}): Promise<Response> {
    const { timeoutMs = TIMEOUTS.quick, action = 'La operación', fallbackError = 'Error del motor', ...init } = options;

    // A caller-supplied signal (unmount, user cancel) composes with the budget
    // rather than replacing it, so neither can leave a request hanging.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
        response = await fetch(`${getApiBase()}${pathname}`, { ...init, signal });
    } catch (error) {
        throw toFriendlyError(error, action);
    }

    if (!response.ok) {
        throw new Error(await readErrorDetail(response, fallbackError));
    }
    return response;
}

export interface PlaylistEntry {
    id: string;
    title: string;
    url: string;
    thumbnail: string | null;
    duration: number | null;
}

export interface VideoInfoResponse {
    id: string;
    title: string;
    thumbnail: string | null;
    duration: number | null;
    channel: string | null;
    view_count: number | null;
    platform?: string;
    formats: Array<{
        format_id: string;
        resolution: string;
        height: number;
        ext: string;
        type: string;
        has_audio: boolean;
        filesize: number | null;
    }>;
    is_playlist?: boolean;
    playlist_count?: number;
    entries?: PlaylistEntry[];
}

export interface DownloadResponse {
    task_id: string;
    status: string;
    message: string;
}

export interface TaskStatusResponse {
    task_id: string;
    status: string;
    progress: number;
    speed: string;
    eta: string;
    filename: string;
    title: string;
    thumbnail: string;
    error: string | null;
}

export interface CompressionResponse {
    task_id: string;
    status: string;
    message: string;
}

export interface CompressionStatusResponse {
    task_id: string;
    status: string;
    progress: number;
    eta: string;
    output_path: string;
    error: string | null;
}

export interface ConvertResponse {
    task_id: string;
    status: string;
    message: string;
}

export interface ConvertStatusResponse {
    task_id: string;
    status: string;
    progress: number;
    eta: string;
    output_path: string;
    error: string | null;
}

export interface LocalInfoResponse {
    duration: number | null;
    size: number | null;
    bit_rate: number | null;
}

export interface CompressionEncoderResponse {
    available: boolean;
    best: string | null;
    all: string[];
}

export interface ApiHealth {
    online: boolean;
    version?: string;
    ffmpeg?: boolean;
}

export async function checkApiHealth(): Promise<boolean> {
    return (await fetchApiHealth()).online;
}

export async function fetchApiHealth(): Promise<ApiHealth> {
    try {
        const response = await fetch(`${getApiBase()}/`, {
            method: 'GET',
            signal: AbortSignal.timeout(TIMEOUTS.health),
        });
        if (!response.ok) return { online: false };
        const body = await response.json();
        return { online: true, version: body?.version, ffmpeg: body?.ffmpeg };
    } catch {
        return { online: false };
    }
}

/**
 * @param signal Optional caller-owned signal, so navigating away from the
 *   Downloader cancels an in-flight analysis instead of leaving it hanging.
 */
export async function fetchVideoInfo(url: string, signal?: AbortSignal): Promise<VideoInfoResponse> {
    const response = await apiFetch(`/info?url=${encodeURIComponent(url)}`, {
        method: 'GET',
        timeoutMs: TIMEOUTS.info,
        signal,
        action: 'El análisis del enlace',
        fallbackError: 'No se pudo analizar el enlace',
    });
    return response.json();
}

export interface StartDownloadOptions {
    url: string;
    formatType: 'video' | 'audio';
    quality: string;
    outputPath?: string;
    outputFormat?: string;
    audioQuality?: string;
    useCookies?: boolean;
    cookiesBrowser?: string | null;
    cookiesFile?: string | null;
}

export async function startDownload(opts: StartDownloadOptions): Promise<DownloadResponse> {
    const response = await apiFetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: TIMEOUTS.mutate,
        action: 'El inicio de la descarga',
        fallbackError: 'No se pudo iniciar la descarga',
        body: JSON.stringify({
            url: opts.url,
            format_type: opts.formatType,
            quality: opts.quality,
            output_path: opts.outputPath,
            output_format: opts.outputFormat,
            audio_quality: opts.audioQuality,
            use_cookies: opts.useCookies || false,
            cookies_browser: opts.cookiesBrowser || null,
            cookies_file: opts.cookiesFile || null,
        }),
    });
    return response.json();
}

export function localThumbnailUrl(path: string): string {
    return `${getApiBase()}/local-thumbnail?path=${encodeURIComponent(path)}`;
}

export interface CookiesSyncStatus {
    exists: boolean;
    path: string | null;
    timestamp: string | null;
    count: number;
}

export async function getCookiesSyncStatus(): Promise<CookiesSyncStatus> {
    const response = await apiFetch('/cookies/sync-status', {
        action: 'La consulta de cookies',
        fallbackError: 'No se pudo consultar el estado de las cookies',
    });
    return response.json();
}

export async function clearSyncedCookies(): Promise<void> {
    await apiFetch('/cookies/sync', {
        method: 'DELETE',
        action: 'El borrado de cookies',
        fallbackError: 'No se pudieron borrar las cookies sincronizadas',
    });
}

export async function startCompression(
    inputPath: string,
    outputPath: string | null,
    outputFormat: string,
    preset: string,
    useGpu: boolean
): Promise<CompressionResponse> {
    const response = await apiFetch('/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: TIMEOUTS.mutate,
        action: 'El inicio de la compresión',
        fallbackError: 'No se pudo iniciar la compresión',
        body: JSON.stringify({
            input_path: inputPath,
            output_path: outputPath,
            output_format: outputFormat,
            preset,
            use_gpu: useGpu,
        }),
    });
    return response.json();
}

export async function fetchCompressionEncoders(): Promise<CompressionEncoderResponse> {
    const response = await apiFetch('/compress/encoders', {
        action: 'La detección de codificadores',
        fallbackError: 'No se pudieron detectar los codificadores',
    });
    return response.json();
}

export async function fetchCompressionStatus(taskId: string): Promise<CompressionStatusResponse> {
    const response = await apiFetch(`/compress/status/${taskId}`, {
        action: 'La consulta de estado',
        fallbackError: 'No se pudo consultar el estado de la compresión',
    });
    return response.json();
}

export async function fetchLocalInfo(path: string): Promise<LocalInfoResponse> {
    const response = await apiFetch(`/local-info?path=${encodeURIComponent(path)}`, {
        action: 'La lectura del archivo',
        fallbackError: 'No se pudo leer el archivo',
    });
    return response.json();
}

export async function startConvert(
    inputPath: string,
    outputPath: string | null,
    outputFormat: string,
    mediaType: 'video' | 'audio' | 'image',
    quality: string
): Promise<ConvertResponse> {
    const response = await apiFetch('/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: TIMEOUTS.mutate,
        action: 'El inicio de la conversión',
        fallbackError: 'No se pudo iniciar la conversión',
        body: JSON.stringify({
            input_path: inputPath,
            output_path: outputPath,
            output_format: outputFormat,
            media_type: mediaType,
            quality,
        }),
    });
    return response.json();
}

/**
 * Shared SSE subscription used by all three task domains.
 *
 * Two behaviours the previous per-domain copies got wrong:
 *   - `onerror` fired when the server closed a *completed* stream, surfacing a
 *     spurious "Connection lost" right after a successful download.
 *   - EventSource auto-reconnects forever by default; once the task is done
 *     (or the caller unsubscribes) we close it so a finished task cannot keep
 *     a connection open against a restarted engine.
 */
function subscribeToEvents<T extends { status: string }>(
    path: string,
    onProgress: (data: T) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    const eventSource = new EventSource(`${getApiBase()}${path}`);
    let settled = false;

    const finish = () => {
        if (settled) return;
        settled = true;
        eventSource.close();
        onComplete();
    };

    eventSource.addEventListener('progress', (event) => {
        try {
            const data = JSON.parse((event as MessageEvent).data) as T;
            onProgress(data);
            if (data.status === 'completed' || data.status === 'error') finish();
        } catch (error) {
            onError(error as Error);
        }
    });

    eventSource.onerror = () => {
        // A close that follows a terminal status is the normal end of stream,
        // not a failure.
        if (settled) return;
        settled = true;
        eventSource.close();
        onError(new Error('Se perdió la conexión con el motor.'));
    };

    return () => {
        settled = true;
        eventSource.close();
    };
}

export function subscribeToConvertEvents(
    taskId: string,
    onProgress: (data: ConvertStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    return subscribeToEvents(`/convert/events/${taskId}`, onProgress, onError, onComplete);
}

export async function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await apiFetch(`/status/${taskId}`, {
        action: 'La consulta de estado',
        fallbackError: 'No se pudo consultar el estado de la descarga',
    });
    return response.json();
}

export async function cancelDownload(taskId: string): Promise<void> {
    await apiFetch(`/cancel/${taskId}`, {
        method: 'DELETE',
        action: 'La cancelación',
        fallbackError: 'No se pudo cancelar la descarga',
    });
}

export async function cancelCompression(taskId: string): Promise<void> {
    await apiFetch(`/compress/cancel/${taskId}`, {
        method: 'DELETE',
        action: 'La cancelación',
        fallbackError: 'No se pudo cancelar la compresión',
    });
}

export async function cancelConvert(taskId: string): Promise<void> {
    await apiFetch(`/convert/cancel/${taskId}`, {
        method: 'DELETE',
        action: 'La cancelación',
        fallbackError: 'No se pudo cancelar la conversión',
    });
}




export function subscribeToTaskEvents(
    taskId: string,
    onProgress: (data: TaskStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    return subscribeToEvents(`/events/${taskId}`, onProgress, onError, onComplete);
}

export function subscribeToCompressionEvents(
    taskId: string,
    onProgress: (data: CompressionStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    return subscribeToEvents(`/compress/events/${taskId}`, onProgress, onError, onComplete);
}
