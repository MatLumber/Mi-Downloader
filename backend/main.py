"""
GravityDown - FastAPI Backend
High-performance media extraction API.
"""

import asyncio
import os
import sys
import json
import uuid
import time
import threading
import subprocess
import shutil
import urllib.request
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from sse_starlette.sse import EventSourceResponse

from downloader import DownloadManager, DownloadStatus

# Initialize FastAPI app
app = FastAPI(
    title="GravityDown API",
    description="High-performance YouTube media extraction engine",
    version="1.0.0",
)

# CORS for Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global download manager
manager = DownloadManager()

compression_tasks = {}
compression_lock = threading.Lock()
compression_executor = asyncio.get_event_loop().run_in_executor
compression_encoders = {
    "available": False,
    "best": None,
    "all": [],
}

convert_tasks = {}
convert_lock = threading.Lock()


class CompressionStatus(str, Enum):
    PENDING = "pending"
    COMPRESSING = "compressing"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class CompressionTask:
    task_id: str
    input_path: str
    output_path: str
    status: CompressionStatus = CompressionStatus.PENDING
    progress: float = 0.0
    eta: str = "N/A"
    error: Optional[str] = None
    process: Optional[Any] = None


# ============ Pydantic Models ============

class VideoInfoResponse(BaseModel):
    id: str
    title: str
    thumbnail: Optional[str]
    duration: Optional[int]
    channel: Optional[str]
    view_count: Optional[int]
    platform: Optional[str] = "other"
    formats: list


class DownloadRequest(BaseModel):
    url: str
    format_type: str = "video"  # "video" or "audio"
    quality: str = "best"  # "best", "1080", "720", etc.
    output_path: Optional[str] = None
    output_format: Optional[str] = None  # mp4, mkv, avi, webm, mp3, wav, flac
    audio_quality: Optional[str] = None  # 320, 256, 192, 128


class DownloadResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    speed: str
    eta: str
    filename: str
    title: str
    thumbnail: str
    error: Optional[str]


class CompressionRequest(BaseModel):
    input_path: str
    output_path: Optional[str] = None
    output_format: Optional[str] = "mp4"  # mp4, mkv, webm
    preset: Optional[str] = "high"  # high, balanced, light
    use_gpu: Optional[bool] = False


class CompressionResponse(BaseModel):
    task_id: str
    status: str
    message: str


class CompressionStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    eta: str
    output_path: str
    error: Optional[str]


class ConvertRequest(BaseModel):
    input_path: str
    output_path: Optional[str] = None
    output_format: str
    media_type: str  # video, audio, image
    quality: Optional[str] = "balanced"


class ConvertResponse(BaseModel):
    task_id: str
    status: str
    message: str


class ConvertStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    eta: str
    output_path: str
    error: Optional[str]


class LocalInfoResponse(BaseModel):
    duration: Optional[float]
    size: Optional[int]
    bit_rate: Optional[int]


@dataclass
class ConvertTask:
    task_id: str
    input_path: str
    output_path: str
    status: str = "pending"
    progress: float = 0.0
    eta: str = "N/A"
    error: Optional[str] = None
    process: Optional[Any] = None


class CompressionEncoderResponse(BaseModel):
    available: bool
    best: Optional[str]
    all: list


def _find_binary(binary_name: str, env_key: str) -> Optional[str]:
    env_path = os.environ.get(env_key)
    if env_path and os.path.isfile(env_path):
        return env_path

    candidates = []
    base_dir = getattr(sys, "_MEIPASS", None)
    if base_dir:
        candidates.append(os.path.join(base_dir, binary_name))
    candidates.append(os.path.join(os.getcwd(), binary_name))
    candidates.append(os.path.join(os.path.dirname(__file__), binary_name))
    candidates.append(os.path.join(os.path.dirname(sys.executable), binary_name))
    candidates.append(os.path.join(os.path.dirname(sys.executable), "ffmpeg", binary_name))
    candidates.append(os.path.join(os.path.dirname(sys.executable), "..", "ffmpeg", binary_name))

    for path in candidates:
        if os.path.isfile(path):
            return path

    return shutil.which(binary_name)


def _expand_path(path_value: str) -> str:
    if not path_value:
        return path_value
    expanded = os.path.expanduser(path_value)
    return os.path.abspath(expanded)


def _detect_encoders() -> None:
    ffmpeg = _find_binary("ffmpeg.exe", "FFMPEG_PATH") or _find_binary("ffmpeg", "FFMPEG_PATH")
    if not ffmpeg:
        return

    try:
        result = subprocess.run([
            ffmpeg,
            "-encoders",
        ], capture_output=True, text=True, check=True)
        output = result.stdout
    except Exception:
        return

    available = []
    for encoder in ["h264_nvenc", "h264_qsv", "h264_amf"]:
        if encoder in output:
            available.append(encoder)

    best = None
    for encoder in ["h264_nvenc", "h264_qsv", "h264_amf"]:
        if encoder in available:
            best = encoder
            break

    compression_encoders["available"] = bool(available)
    compression_encoders["best"] = best
    compression_encoders["all"] = available


def _get_duration_ms(input_path: str) -> Optional[int]:
    ffprobe = _find_binary("ffprobe.exe", "FFPROBE_PATH") or _find_binary("ffprobe", "FFPROBE_PATH")
    if not ffprobe:
        return None

    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        duration = float(result.stdout.strip())
        return int(duration * 1000)
    except Exception:
        return None


def _get_local_info(input_path: str) -> dict:
    ffprobe = _find_binary("ffprobe.exe", "FFPROBE_PATH") or _find_binary("ffprobe", "FFPROBE_PATH")
    if not ffprobe:
        return {"duration": None, "size": None, "bit_rate": None}

    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration,size,bit_rate",
                "-of",
                "json",
                input_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(result.stdout or "{}")
        fmt = data.get("format", {})
        duration = float(fmt.get("duration")) if fmt.get("duration") else None
        size = int(fmt.get("size")) if fmt.get("size") else None
        bit_rate = int(fmt.get("bit_rate")) if fmt.get("bit_rate") else None
        return {"duration": duration, "size": size, "bit_rate": bit_rate}
    except Exception:
        return {"duration": None, "size": None, "bit_rate": None}


def _build_output_path(input_path: str, output_dir: str, output_format: str) -> str:
    base = os.path.splitext(os.path.basename(input_path))[0]
    safe_base = f"{base}-compressed"
    ext = output_format.lower()
    output_path = os.path.join(output_dir, f"{safe_base}.{ext}")

    if not os.path.exists(output_path):
        return output_path

    for index in range(2, 50):
        candidate = os.path.join(output_dir, f"{safe_base}-{index}.{ext}")
        if not os.path.exists(candidate):
            return candidate

    return os.path.join(output_dir, f"{safe_base}-{int(time.time())}.{ext}")


def _build_convert_output_path(input_path: str, output_dir: str, output_format: str) -> str:
    base = os.path.splitext(os.path.basename(input_path))[0]
    safe_base = f"{base}-converted"
    ext = output_format.lower()
    output_path = os.path.join(output_dir, f"{safe_base}.{ext}")

    if not os.path.exists(output_path):
        return output_path

    for index in range(2, 50):
        candidate = os.path.join(output_dir, f"{safe_base}-{index}.{ext}")
        if not os.path.exists(candidate):
            return candidate

    return os.path.join(output_dir, f"{safe_base}-{int(time.time())}.{ext}")


def _run_compression(task_id: str, input_path: str, output_dir: str, output_format: str, preset: str) -> None:
    ffmpeg = _find_binary("ffmpeg.exe", "FFMPEG_PATH") or _find_binary("ffmpeg", "FFMPEG_PATH")
    if not ffmpeg:
        with compression_lock:
            task = compression_tasks.get(task_id)
            if task:
                task.status = CompressionStatus.ERROR
                task.error = "ffmpeg no encontrado. Instala ffmpeg o configura FFMPEG_PATH."
        return

    input_path = _expand_path(input_path)
    output_dir = _expand_path(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    output_path = _build_output_path(input_path, output_dir, output_format)
    duration_ms = _get_duration_ms(input_path)

    preset_key = (preset or "high").lower()
    crf_map = {
        "high": 20,
        "balanced": 24,
        "light": 28,
    }
    crf = crf_map.get(preset_key, 20)

    scale_filter = None
    if preset_key == "balanced":
        scale_filter = "scale='min(1920,iw)':-2"
    elif preset_key == "light":
        scale_filter = "scale='min(1280,iw)':-2"

    format_key = (output_format or "mp4").lower()
    use_gpu = False
    gpu_encoder = compression_encoders.get("best")
    with compression_lock:
        task = compression_tasks.get(task_id)
        if task and getattr(task, "use_gpu", False):
            use_gpu = True

    if use_gpu and not gpu_encoder:
        use_gpu = False

    if format_key == "webm":
        video_codec = "libvpx-vp9"
        audio_codec = "libopus"
        audio_bitrate = "128k" if preset_key != "high" else "160k"
        v_crf = crf + 12
        video_args = ["-c:v", video_codec, "-b:v", "0", "-crf", str(v_crf)]
    else:
        audio_codec = "aac"
        audio_bitrate = "192k" if preset_key == "high" else "160k" if preset_key == "balanced" else "128k"
        if use_gpu and gpu_encoder:
            video_codec = gpu_encoder
            if gpu_encoder == "h264_nvenc":
                cq = 20 if preset_key == "high" else 23 if preset_key == "balanced" else 27
                video_args = ["-c:v", video_codec, "-rc", "vbr", "-cq", str(cq), "-preset", "p4"]
            elif gpu_encoder == "h264_qsv":
                qsv_q = 20 if preset_key == "high" else 23 if preset_key == "balanced" else 28
                video_args = ["-c:v", video_codec, "-global_quality", str(qsv_q)]
            else:
                amf_q = 20 if preset_key == "high" else 24 if preset_key == "balanced" else 28
                video_args = ["-c:v", video_codec, "-quality", "quality", "-qp_i", str(amf_q), "-qp_p", str(amf_q), "-qp_b", str(amf_q + 2)]
        else:
            video_codec = "libx264"
            preset_speed = "slow" if preset_key == "high" else "medium"
            video_args = ["-c:v", video_codec, "-preset", preset_speed, "-crf", str(crf)]

    filters = []
    if scale_filter:
        filters.extend(["-vf", scale_filter])

    extra_flags = []
    if format_key == "mp4":
        extra_flags = ["-movflags", "+faststart"]

    command = [
        ffmpeg,
        "-y",
        "-i",
        input_path,
        "-map_metadata",
        "0",
        *filters,
        *video_args,
        "-c:a",
        audio_codec,
        "-b:a",
        audio_bitrate,
        *extra_flags,
        "-progress",
        "pipe:1",
        output_path,
    ]

    print(f"[COMPRESS] encoder={video_codec} gpu={use_gpu} preset={preset_key} duration_ms={duration_ms}")
    print(f"[COMPRESS] cmd={' '.join(command)}")

    with compression_lock:
        task = compression_tasks.get(task_id)
        if task:
            task.output_path = output_path
            task.status = CompressionStatus.COMPRESSING

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        bufsize=0,
    )

    with compression_lock:
        task = compression_tasks.get(task_id)
        if task:
            task.process = process

    out_time_ms = 0
    last_progress = 0.0
    log_count = 0
    last_error_lines = []

    def handle_line(line: str):
        nonlocal out_time_ms, last_progress, log_count

        if "time=" in line:
            try:
                time_part = line.split("time=")[1].split()[0]
                h, m, s = time_part.split(":")
                seconds = float(s) + (int(m) * 60) + (int(h) * 3600)
                out_time_ms = seconds * 1000
                if duration_ms:
                    progress = min(100.0, (out_time_ms / duration_ms) * 100)
                else:
                    progress = min(99.0, last_progress + 0.2)
                with compression_lock:
                    task = compression_tasks.get(task_id)
                    if task:
                        task.progress = progress
                last_progress = progress
            except Exception:
                pass

        if "=" not in line:
            if log_count < 40:
                print(f"[COMPRESS] {line.strip()}")
                log_count += 1
            return

        key, value = line.strip().split("=", 1)
        if log_count < 20 and key in {"out_time_ms", "out_time_us", "out_time", "progress", "total_size"}:
            print(f"[COMPRESS] {key}={value}")
            log_count += 1

        if key == "out_time_ms":
            try:
                raw_value = float(value)
            except ValueError:
                return

            if duration_ms and raw_value > duration_ms * 10:
                out_time_ms = raw_value / 1000
            else:
                out_time_ms = raw_value

            if duration_ms:
                progress = min(100.0, (out_time_ms / duration_ms) * 100)
            else:
                progress = min(99.0, last_progress + 0.2)

            with compression_lock:
                task = compression_tasks.get(task_id)
                if task:
                    task.progress = progress
            last_progress = progress
        elif key == "out_time_us":
            try:
                raw_value = float(value)
            except ValueError:
                return

            out_time_ms = raw_value / 1000

            if duration_ms:
                progress = min(100.0, (out_time_ms / duration_ms) * 100)
            else:
                progress = min(99.0, last_progress + 0.2)

            with compression_lock:
                task = compression_tasks.get(task_id)
                if task:
                    task.progress = progress
            last_progress = progress
        elif key == "out_time":
            parts = value.split(':')
            if len(parts) == 3:
                try:
                    seconds_part = float(parts[2])
                    minutes_part = float(parts[1])
                    hours_part = float(parts[0])
                    out_time_ms = ((hours_part * 3600) + (minutes_part * 60) + seconds_part) * 1000
                except ValueError:
                    return

                if duration_ms:
                    progress = min(100.0, (out_time_ms / duration_ms) * 100)
                else:
                    progress = min(99.0, last_progress + 0.2)

                with compression_lock:
                    task = compression_tasks.get(task_id)
                    if task:
                        task.progress = progress
                last_progress = progress
        elif key == "progress" and value == "continue":
            if not duration_ms:
                progress = min(99.0, last_progress + 0.3)
                with compression_lock:
                    task = compression_tasks.get(task_id)
                    if task:
                        task.progress = progress
                last_progress = progress

    def decode_line(raw: bytes) -> str:
        try:
            return raw.decode('utf-8', errors='ignore')
        except Exception:
            return raw.decode(errors='ignore')

    def read_stream(stream):
        if not stream:
            return
        for raw in iter(stream.readline, b''):
            line = decode_line(raw)
            handle_line(line)

    threads = []
    if process.stdout:
        t_out = threading.Thread(target=read_stream, args=(process.stdout,), daemon=True)
        threads.append(t_out)
        t_out.start()
    if process.stderr:
        def read_err():
            if not process.stderr:
                return
            for raw in iter(process.stderr.readline, b''):
                line = decode_line(raw).strip()
                last_error_lines.append(line)
                handle_line(line)

        t_err = threading.Thread(target=read_err, daemon=True)
        threads.append(t_err)
        t_err.start()

    process.wait()
    for t in threads:
        t.join(timeout=0.2)

    with compression_lock:
        task = compression_tasks.get(task_id)
        if not task:
            return
        # If canceled manually, do not overwrite the error
        if task.error == "Cancelled by user":
            return
            
        if process.returncode == 0:
            task.status = CompressionStatus.COMPLETED
            task.progress = 100.0
        else:
            task.status = CompressionStatus.ERROR
            tail = "\n".join(last_error_lines[-5:])
            task.error = tail or "Error al comprimir el video."


def _run_convert(task_id: str, input_path: str, output_dir: str, output_format: str, media_type: str, quality: str) -> None:
    ffmpeg = _find_binary("ffmpeg.exe", "FFMPEG_PATH") or _find_binary("ffmpeg", "FFMPEG_PATH")
    if not ffmpeg:
        with convert_lock:
            task = convert_tasks.get(task_id)
            if task:
                task.status = "error"
                task.error = "ffmpeg no encontrado."
        return

    input_path = _expand_path(input_path)
    output_dir = _expand_path(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    output_path = _build_convert_output_path(input_path, output_dir, output_format)
    duration_ms = _get_duration_ms(input_path)

    fmt = output_format.lower()
    q = (quality or "balanced").lower()
    command = [ffmpeg, "-y", "-i", input_path]

    if media_type == "image":
        if fmt in {"jpg", "jpeg"}:
            qv = "2" if q == "high" else "4" if q == "balanced" else "6"
            command += ["-q:v", qv]
        elif fmt == "webp":
            qv = "85" if q == "high" else "75" if q == "balanced" else "65"
            command += ["-q:v", qv]
        elif fmt in {"png"}:
            command += ["-compression_level", "6"]
        command += [output_path]
    elif media_type == "audio":
        bitrate = "320k" if q == "high" else "192k" if q == "balanced" else "128k"
        if fmt in {"wav", "flac"}:
            command += ["-vn", "-c:a", fmt]
        elif fmt == "ogg":
            command += ["-vn", "-c:a", "libvorbis", "-b:a", bitrate]
        elif fmt == "opus":
            command += ["-vn", "-c:a", "libopus", "-b:a", bitrate]
        elif fmt == "m4a":
            command += ["-vn", "-c:a", "aac", "-b:a", bitrate]
        else:
            command += ["-vn", "-c:a", fmt, "-b:a", bitrate]
        command += [output_path]
    else:
        if fmt == "webm":
            command += ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-c:a", "libopus", "-b:a", "128k"]
        else:
            crf = "20" if q == "high" else "24" if q == "balanced" else "28"
            command += ["-c:v", "libx264", "-preset", "medium", "-crf", crf, "-c:a", "aac", "-b:a", "160k"]
        if fmt in {"mp4", "m4v", "mov"}:
            command += ["-movflags", "+faststart"]
        command += [output_path]

    command += ["-progress", "pipe:1"]

    with convert_lock:
        task = convert_tasks.get(task_id)
        if task:
            task.output_path = output_path
            task.status = "processing"

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        bufsize=0,
    )

    with convert_lock:
        task = convert_tasks.get(task_id)
        if task:
            task.process = process

    out_time_ms = 0
    last_progress = 0.0
    last_error_lines = []

    def decode_line(raw: bytes) -> str:
        try:
            return raw.decode('utf-8', errors='ignore')
        except Exception:
            return raw.decode(errors='ignore')

    def handle_line(line: str):
        nonlocal out_time_ms, last_progress
        if "time=" in line:
            try:
                time_part = line.split("time=")[1].split()[0]
                h, m, s = time_part.split(":")
                seconds = float(s) + (int(m) * 60) + (int(h) * 3600)
                out_time_ms = seconds * 1000
                if duration_ms:
                    progress = min(100.0, (out_time_ms / duration_ms) * 100)
                else:
                    progress = min(99.0, last_progress + 0.2)
                with convert_lock:
                    task = convert_tasks.get(task_id)
                    if task:
                        task.progress = progress
                last_progress = progress
            except Exception:
                pass

        if "=" not in line:
            return
        key, value = line.strip().split("=", 1)
        if key == "out_time_ms":
            try:
                raw_value = float(value)
            except ValueError:
                return
            if duration_ms and raw_value > duration_ms * 10:
                out_time_ms = raw_value / 1000
            else:
                out_time_ms = raw_value
        elif key == "out_time_us":
            try:
                out_time_ms = float(value) / 1000
            except ValueError:
                return

        if key in {"out_time_ms", "out_time_us", "out_time"}:
            if duration_ms:
                progress = min(100.0, (out_time_ms / duration_ms) * 100)
            else:
                progress = min(99.0, last_progress + 0.2)
            with convert_lock:
                task = convert_tasks.get(task_id)
                if task:
                    task.progress = progress
            last_progress = progress

    def read_stream(stream):
        if not stream:
            return
        for raw in iter(stream.readline, b''):
            handle_line(decode_line(raw))

    threads = []
    if process.stdout:
        t_out = threading.Thread(target=read_stream, args=(process.stdout,), daemon=True)
        threads.append(t_out)
        t_out.start()
    if process.stderr:
        def read_err():
            if not process.stderr:
                return
            for raw in iter(process.stderr.readline, b''):
                line = decode_line(raw).strip()
                last_error_lines.append(line)
                handle_line(line)

        t_err = threading.Thread(target=read_err, daemon=True)
        threads.append(t_err)
        t_err.start()

    process.wait()
    for t in threads:
        t.join(timeout=0.2)

    with convert_lock:
        task = convert_tasks.get(task_id)
        if not task:
            return
        # If canceled manually, do not overwrite the error
        if task.error == "Cancelled by user":
            return

        if process.returncode == 0:
            task.status = "completed"
            task.progress = 100.0
        else:
            task.status = "error"
            tail = "\n".join(last_error_lines[-5:])
            task.error = tail or "Error al convertir."


# ============ API Endpoints ============

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "name": "GravityDown API",
        "status": "online",
        "version": "1.0.0"
    }


@app.get("/info", response_model=VideoInfoResponse)
async def get_video_info(url: str = Query(..., description="YouTube video URL")):
    """
    Fetch video metadata and available formats.
    """
    try:
        info = manager.get_video_info(url)
        return VideoInfoResponse(**info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/thumbnail")
async def get_thumbnail(url: str = Query(..., description="Remote thumbnail URL")):
    try:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            content_type = response.headers.get("Content-Type", "image/jpeg")
            data = response.read()

        return Response(content=data, media_type=content_type, headers={
            "Cache-Control": "public, max-age=3600",
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/download", response_model=DownloadResponse)
async def start_download(request: DownloadRequest):
    """
    Start a new download task.
    Returns a task ID for tracking progress.
    """
    try:
        task_id = manager.start_download(
            url=request.url,
            format_type=request.format_type,
            quality=request.quality,
            output_path=request.output_path,
            output_format=request.output_format,
            audio_quality=request.audio_quality
        )
        
        return DownloadResponse(
            task_id=task_id,
            status="started",
            message=f"Download initiated. Track with /status/{task_id}"
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """
    Get the current status of a download task.
    """
    task = manager.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return TaskStatusResponse(
        task_id=task.task_id,
        status=task.status.value,
        progress=task.progress,
        speed=task.speed,
        eta=task.eta,
        filename=task.filename,
        title=task.title,
        thumbnail=task.thumbnail,
        error=task.error
    )


@app.get("/events/{task_id}")
async def task_events(task_id: str):
    """
    Server-Sent Events stream for real-time progress updates.
    """
    task = manager.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    async def event_generator():
        while True:
            task = manager.get_task(task_id)
            
            if not task:
                break
            
            data = {
                "task_id": task.task_id,
                "status": task.status.value,
                "progress": task.progress,
                "speed": task.speed,
                "eta": task.eta,
                "filename": task.filename,
                "title": task.title,
                "error": task.error
            }
            
            yield {
                "event": "progress",
                "data": json.dumps(data)
            }
            
            # Stop streaming on completion or error
            if task.status in [DownloadStatus.COMPLETED, DownloadStatus.ERROR]:
                break
            
            await asyncio.sleep(0.5)
    
    return EventSourceResponse(event_generator())


@app.delete("/cancel/{task_id}")
async def cancel_download(task_id: str):
    """
    Cancel an in-progress download.
    """
    success = manager.cancel_task(task_id)
    
    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel this task")
    
    return {"status": "cancelled", "task_id": task_id}


@app.delete("/compress/cancel/{task_id}")
async def cancel_compression(task_id: str):
    """
    Cancel an in-progress compression.
    """
    with compression_lock:
        task = compression_tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        if task.status != CompressionStatus.COMPRESSING:
            raise HTTPException(status_code=400, detail="Cannot cancel this task")
        
        if task.process:
            task.process.terminate()
            try:
                task.process.wait(timeout=5)
            except:
                task.process.kill()
        
        task.status = CompressionStatus.ERROR
        task.error = "Cancelled by user"
    
    return {"status": "cancelled", "task_id": task_id}


@app.delete("/convert/cancel/{task_id}")
async def cancel_convert(task_id: str):
    """
    Cancel an in-progress conversion.
    """
    with convert_lock:
        task = convert_tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        if task.status != "processing":
            raise HTTPException(status_code=400, detail="Cannot cancel this task")
        
        if task.process:
            task.process.terminate()
            try:
                task.process.wait(timeout=5)
            except:
                task.process.kill()
        
        task.status = "error"
        task.error = "Cancelled by user"
    
    return {"status": "cancelled", "task_id": task_id}


@app.post("/compress", response_model=CompressionResponse)
async def start_compression(request: CompressionRequest):
    input_path = _expand_path(request.input_path)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=400, detail="Archivo de entrada no encontrado")

    with compression_lock:
        for existing in compression_tasks.values():
            if existing.status == CompressionStatus.COMPRESSING:
                raise HTTPException(status_code=409, detail="Ya hay una compresion en curso")

    task_id = str(uuid.uuid4())[:8]
    output_dir = _expand_path(request.output_path) if request.output_path else os.path.dirname(input_path)
    output_format = (request.output_format or "mp4").lower()

    with compression_lock:
        compression_tasks[task_id] = CompressionTask(
            task_id=task_id,
            input_path=input_path,
            output_path="",
        )
        compression_tasks[task_id].use_gpu = bool(request.use_gpu)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None,
        _run_compression,
        task_id,
        input_path,
        output_dir,
        output_format,
        request.preset or "high",
    )

    return CompressionResponse(
        task_id=task_id,
        status="started",
        message="Compression initiated. Track with /compress/status/{task_id}"
    )


@app.get("/compress/encoders", response_model=CompressionEncoderResponse)
async def get_compression_encoders():
    if not compression_encoders.get("all"):
        _detect_encoders()
    return CompressionEncoderResponse(**compression_encoders)


@app.on_event("startup")
async def on_startup():
    _detect_encoders()


@app.get("/compress/status/{task_id}", response_model=CompressionStatusResponse)
async def get_compression_status(task_id: str):
    with compression_lock:
        task = compression_tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return CompressionStatusResponse(
        task_id=task.task_id,
        status=task.status.value,
        progress=task.progress,
        eta=task.eta,
        output_path=task.output_path,
        error=task.error,
    )


@app.get("/compress/events/{task_id}")
async def compression_events(task_id: str):
    with compression_lock:
        task = compression_tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        while True:
            with compression_lock:
                task = compression_tasks.get(task_id)

            if not task:
                break

            data = {
                "task_id": task.task_id,
                "status": task.status.value,
                "progress": task.progress,
                "eta": task.eta,
                "output_path": task.output_path,
                "error": task.error,
            }

            yield {
                "event": "progress",
                "data": json.dumps(data)
            }

            if task.status in [CompressionStatus.COMPLETED, CompressionStatus.ERROR]:
                break

            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@app.post("/convert", response_model=ConvertResponse)
async def start_convert(request: ConvertRequest):
    input_path = _expand_path(request.input_path)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=400, detail="Archivo de entrada no encontrado")

    task_id = str(uuid.uuid4())[:8]
    output_dir = _expand_path(request.output_path) if request.output_path else os.path.dirname(input_path)

    with convert_lock:
        convert_tasks[task_id] = ConvertTask(
            task_id=task_id,
            input_path=input_path,
            output_path="",
        )

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None,
        _run_convert,
        task_id,
        input_path,
        output_dir,
        request.output_format,
        request.media_type,
        request.quality or "balanced",
    )

    return ConvertResponse(
        task_id=task_id,
        status="started",
        message="Conversion initiated. Track with /convert/status/{task_id}"
    )


@app.get("/convert/status/{task_id}", response_model=ConvertStatusResponse)
async def get_convert_status(task_id: str):
    with convert_lock:
        task = convert_tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return ConvertStatusResponse(
        task_id=task.task_id,
        status=task.status,
        progress=task.progress,
        eta=task.eta,
        output_path=task.output_path,
        error=task.error,
    )


@app.get("/convert/events/{task_id}")
async def convert_events(task_id: str):
    with convert_lock:
        task = convert_tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        while True:
            with convert_lock:
                task = convert_tasks.get(task_id)

            if not task:
                break

            data = {
                "task_id": task.task_id,
                "status": task.status,
                "progress": task.progress,
                "eta": task.eta,
                "output_path": task.output_path,
                "error": task.error,
            }

            yield {
                "event": "progress",
                "data": json.dumps(data)
            }

            if task.status in ["completed", "error"]:
                break

            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@app.get("/local-info", response_model=LocalInfoResponse)
async def get_local_info(path: str = Query(..., description="Local file path")):
    input_path = _expand_path(path)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=400, detail="Archivo de entrada no encontrado")

    info = _get_local_info(input_path)
    return LocalInfoResponse(**info)


# ============ Run Server ============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")

_detect_encoders()
