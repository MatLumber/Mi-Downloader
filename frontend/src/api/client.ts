export const API_BASE = 'http://127.0.0.1:8765';

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

export async function checkApiHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function fetchVideoInfo(url: string): Promise<VideoInfoResponse> {
    const response = await fetch(`${API_BASE}/info?url=${encodeURIComponent(url)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch video info');
    }

    return response.json();
}

export async function startDownload(
    url: string,
    formatType: 'video' | 'audio',
    quality: string,
    outputPath?: string,
    outputFormat?: string,
    audioQuality?: string
): Promise<DownloadResponse> {
    const response = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            url,
            format_type: formatType,
            quality,
            output_path: outputPath,
            output_format: outputFormat,
            audio_quality: audioQuality
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to start download');
    }

    return response.json();
}

export async function startCompression(
    inputPath: string,
    outputPath: string | null,
    outputFormat: string,
    preset: string,
    useGpu: boolean
): Promise<CompressionResponse> {
    const response = await fetch(`${API_BASE}/compress`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            input_path: inputPath,
            output_path: outputPath,
            output_format: outputFormat,
            preset,
            use_gpu: useGpu,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to start compression');
    }

    return response.json();
}

export async function fetchCompressionEncoders(): Promise<CompressionEncoderResponse> {
    const response = await fetch(`${API_BASE}/compress/encoders`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch encoders');
    }

    return response.json();
}

export async function fetchCompressionStatus(taskId: string): Promise<CompressionStatusResponse> {
    const response = await fetch(`${API_BASE}/compress/status/${taskId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch compression status');
    }

    return response.json();
}

export async function fetchLocalInfo(path: string): Promise<LocalInfoResponse> {
    const response = await fetch(`${API_BASE}/local-info?path=${encodeURIComponent(path)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch local info');
    }

    return response.json();
}

export async function startConvert(
    inputPath: string,
    outputPath: string | null,
    outputFormat: string,
    mediaType: 'video' | 'audio' | 'image',
    quality: string
): Promise<ConvertResponse> {
    const response = await fetch(`${API_BASE}/convert`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            input_path: inputPath,
            output_path: outputPath,
            output_format: outputFormat,
            media_type: mediaType,
            quality,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to start convert');
    }

    return response.json();
}

export function subscribeToConvertEvents(
    taskId: string,
    onProgress: (data: ConvertStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    const eventSource = new EventSource(`${API_BASE}/convert/events/${taskId}`);

    eventSource.addEventListener('progress', (event) => {
        try {
            const data = JSON.parse(event.data);
            onProgress(data);

            if (data.status === 'completed' || data.status === 'error') {
                eventSource.close();
                onComplete();
            }
        } catch (e) {
            onError(e as Error);
        }
    });

    eventSource.onerror = () => {
        onError(new Error('Connection lost'));
        eventSource.close();
    };

    return () => eventSource.close();
}

export async function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await fetch(`${API_BASE}/status/${taskId}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to get task status');
    }

    return response.json();
}

export function subscribeToTaskEvents(
    taskId: string,
    onProgress: (data: TaskStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    const eventSource = new EventSource(`${API_BASE}/events/${taskId}`);

    eventSource.addEventListener('progress', (event) => {
        try {
            const data = JSON.parse(event.data);
            onProgress(data);

            if (data.status === 'completed' || data.status === 'error') {
                eventSource.close();
                onComplete();
            }
        } catch (e) {
            onError(e as Error);
        }
    });

    eventSource.onerror = () => {
        onError(new Error('Connection lost'));
        eventSource.close();
    };

    return () => eventSource.close();
}

export function subscribeToCompressionEvents(
    taskId: string,
    onProgress: (data: CompressionStatusResponse) => void,
    onError: (error: Error) => void,
    onComplete: () => void
): () => void {
    const eventSource = new EventSource(`${API_BASE}/compress/events/${taskId}`);

    eventSource.addEventListener('progress', (event) => {
        try {
            const data = JSON.parse(event.data);
            onProgress(data);

            if (data.status === 'completed' || data.status === 'error') {
                eventSource.close();
                onComplete();
            }
        } catch (e) {
            onError(e as Error);
        }
    });

    eventSource.onerror = () => {
        onError(new Error('Connection lost'));
        eventSource.close();
    };

    return () => eventSource.close();
}
