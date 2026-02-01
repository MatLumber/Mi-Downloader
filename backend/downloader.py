"""
GravityDown - DownloadManager
Wraps yt-dlp for threaded downloads with progress callbacks.
"""

import os
import uuid
import re
import sys
import shutil
from urllib.parse import urlparse
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional, Dict, Any
import yt_dlp


def sanitize_filename(filename: str) -> str:
    """Remove or replace characters that are invalid in Windows filenames."""
    # Characters not allowed in Windows filenames: \ / : * ? " < > |
    invalid_chars = r'[\\/:*?"<>|]'
    sanitized = re.sub(invalid_chars, '_', filename)
    # Also replace any control characters and limit length
    sanitized = re.sub(r'[\x00-\x1f]', '', sanitized)
    # Limit filename length (Windows max is 255)
    if len(sanitized) > 200:
        sanitized = sanitized[:200]
    return sanitized.strip()


class DownloadStatus(Enum):
    PENDING = "pending"
    FETCHING_INFO = "fetching_info"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class DownloadTask:
    task_id: str
    url: str
    status: DownloadStatus = DownloadStatus.PENDING
    progress: float = 0.0
    speed: str = "0 B/s"
    eta: str = "N/A"
    filename: str = ""
    error: Optional[str] = None
    total_bytes: int = 0
    downloaded_bytes: int = 0
    title: str = ""
    thumbnail: str = ""


class DownloadManager:
    """Thread-safe download manager using yt-dlp."""
    
    def __init__(self, output_dir: Optional[str] = None):
        self.output_dir = output_dir or os.path.join(os.path.expanduser("~"), "Downloads", "GravityDown")
        os.makedirs(self.output_dir, exist_ok=True)
        
        self.tasks: Dict[str, DownloadTask] = {}
        self.executor = ThreadPoolExecutor(max_workers=3)
        self._lock = threading.Lock()
        self._callbacks: Dict[str, Callable[[DownloadTask], None]] = {}
    
    def _format_speed(self, speed: Optional[float]) -> str:
        """Format speed in human-readable format."""
        if not speed:
            return "0 B/s"
        
        units = ["B/s", "KB/s", "MB/s", "GB/s"]
        unit_index = 0
        
        while speed >= 1024 and unit_index < len(units) - 1:
            speed /= 1024
            unit_index += 1
        
        return f"{speed:.1f} {units[unit_index]}"
    
    def _format_eta(self, eta: Optional[float]) -> str:
        """Format ETA in human-readable format."""
        if not eta:
            return "N/A"
        
        minutes, seconds = divmod(int(eta), 60)
        hours, minutes = divmod(minutes, 60)
        
        if hours:
            return f"{hours}h {minutes}m {seconds}s"
        elif minutes:
            return f"{minutes}m {seconds}s"
        else:
            return f"{seconds}s"

    def _find_binary(self, binary_name: str, env_key: str) -> Optional[str]:
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

    def _normalize_url(self, url: str) -> str:
        """Ensure URL has a scheme for proper extractor selection."""
        value = (url or "").strip()
        if not value:
            return value

        parsed = urlparse(value)
        if parsed.scheme:
            return value

        return f"https://{value}"
    
    def _progress_hook(self, task_id: str, d: Dict[str, Any]) -> None:
        """yt-dlp progress hook callback."""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return
            
            status = d.get("status", "")
            
            if status == "downloading":
                task.status = DownloadStatus.DOWNLOADING
                task.downloaded_bytes = d.get("downloaded_bytes", 0)
                task.total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
                
                if task.total_bytes > 0:
                    task.progress = (task.downloaded_bytes / task.total_bytes) * 100
                
                task.speed = self._format_speed(d.get("speed"))
                task.eta = self._format_eta(d.get("eta"))
                task.filename = d.get("filename", "")
                
            elif status == "finished":
                task.status = DownloadStatus.PROCESSING
                task.progress = 100.0
                task.filename = d.get("filename", "")
            
            elif status == "error":
                task.status = DownloadStatus.ERROR
                task.error = str(d.get("error", "Unknown error"))
        
        # Notify callback
        if task_id in self._callbacks:
            self._callbacks[task_id](task)
    
    def get_video_info(self, url: str) -> Dict[str, Any]:
        """Fetch video metadata without downloading."""
        url = self._normalize_url(url)
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                raise ValueError("Could not extract video info")
            
            # Extract available formats
            formats = []
            seen_resolutions = set()
            
            for f in info.get("formats", []):
                height = f.get("height")
                vcodec = f.get("vcodec", "none")
                acodec = f.get("acodec", "none")
                
                # Video formats
                if height and vcodec != "none":
                    resolution = f"{height}p"
                    if resolution not in seen_resolutions:
                        seen_resolutions.add(resolution)
                        formats.append({
                            "format_id": f.get("format_id"),
                            "resolution": resolution,
                            "height": height,
                            "ext": f.get("ext"),
                            "type": "video",
                            "has_audio": acodec != "none",
                            "filesize": f.get("filesize") or f.get("filesize_approx"),
                        })
            
            # Sort by resolution (descending)
            formats.sort(key=lambda x: x.get("height", 0), reverse=True)
            
            duration = info.get("duration")
            if isinstance(duration, float):
                duration = int(duration)

            return {
                "id": info.get("id"),
                "title": info.get("title"),
                "thumbnail": info.get("thumbnail"),
                "duration": duration,
                "channel": info.get("channel") or info.get("uploader"),
                "view_count": info.get("view_count"),
                "platform": self._detect_platform(url),
                "formats": formats,
            }
            
    def _detect_platform(self, url: str) -> str:
        """Detect platform from URL."""
        if "youtube.com" in url or "youtu.be" in url:
            return "youtube"
        elif "tiktok.com" in url:
            return "tiktok"
        elif "instagram.com" in url:
            return "instagram"
        elif "facebook.com" in url or "fb.watch" in url:
            return "facebook"
        elif "twitter.com" in url or "x.com" in url:
            return "twitter"
        elif "twitch.tv" in url:
            return "twitch"
        return "other"
    
    def start_download(
        self,
        url: str,
        format_type: str = "video",  # "video" or "audio"
        quality: str = "best",  # "best", "1080", "720", etc.
        output_path: Optional[str] = None,
        output_format: Optional[str] = None,  # mp4, mkv, avi, webm, mp3, wav, flac, aac, opus
        audio_quality: Optional[str] = None,  # 320, 256, 192, 128
        callback: Optional[Callable[[DownloadTask], None]] = None
    ) -> str:
        """Start a download task and return task ID."""
        url = self._normalize_url(url)
        task_id = str(uuid.uuid4())[:8]
        
        task = DownloadTask(
            task_id=task_id,
            url=url,
            status=DownloadStatus.PENDING
        )
        
        with self._lock:
            self.tasks[task_id] = task
            if callback:
                self._callbacks[task_id] = callback
        
        # Submit to thread pool
        self.executor.submit(self._download_worker, task_id, url, format_type, quality, output_path, output_format, audio_quality)
        
        return task_id
    
    def _download_worker(
        self,
        task_id: str,
        url: str,
        format_type: str,
        quality: str,
        output_path: Optional[str] = None,
        output_format: Optional[str] = None,
        audio_quality: Optional[str] = None
    ) -> None:
        """Worker thread for downloading."""
        try:
            with self._lock:
                task = self.tasks[task_id]
                task.status = DownloadStatus.FETCHING_INFO
            
            # Use custom output path or default
            target_dir = output_path or self.output_dir
            os.makedirs(target_dir, exist_ok=True)
            
            # PRE-FETCH INFO to determine title and ensure consistency
            # This is crucial to avoid mismatch between yt-dlp's sanitization and ours
            pre_opts = {
                "quiet": True, 
                "no_warnings": True, 
                "extract_flat": True 
            }
            with yt_dlp.YoutubeDL(pre_opts) as ydl_pre:
                try:
                    pre_info = ydl_pre.extract_info(url, download=False)
                    # Sanitize title strictly using our function
                    safe_title = sanitize_filename(pre_info.get('title', 'download'))
                except Exception:
                    # Fallback if pre-fetch fails
                    safe_title = f"download_{task_id}"

            # Build format selector and postprocessors
            if format_type == "audio":
                format_selector = "bestaudio/best"
                
                # Determine audio codec and extension
                audio_fmt = output_format or "mp3"
                audio_bitrate = audio_quality or "320"
                
                # Map format to codec
                codec_map = {
                    "mp3": "mp3",
                    "wav": "wav",
                    "flac": "flac",
                    "aac": "aac",
                    "opus": "opus",
                    "m4a": "m4a"
                }
                codec = codec_map.get(audio_fmt, "mp3")
                ext = audio_fmt
                
                postprocessors = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": codec,
                    "preferredquality": audio_bitrate,
                }]
                merge_format = None
                final_ext = ext
            else:
                # Video format handling
                video_fmt = output_format or "mp4"
                ext = video_fmt
                
                if quality == "best":
                    format_selector = f"bestvideo+bestaudio/best"
                else:
                    height = quality.replace("p", "")
                    format_selector = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
                
                # Postprocessors for video conversion
                if video_fmt in ["mkv", "avi", "webm"]:
                    postprocessors = [{
                        "key": "FFmpegVideoConvertor",
                        "preferedformat": video_fmt,
                    }]
                else:
                    postprocessors = [{
                        "key": "FFmpegVideoConvertor",
                        "preferedformat": "mp4",
                    }]
                
                merge_format = video_fmt
                final_ext = video_fmt
            
            # Use explicit filename template with our pre-sanitized title
            outtmpl = os.path.join(target_dir, f"{safe_title}.%(ext)s")

            ffmpeg_path = self._find_binary("ffmpeg.exe", "FFMPEG_PATH") or self._find_binary("ffmpeg", "FFMPEG_PATH")
            ffmpeg_location = os.path.dirname(ffmpeg_path) if ffmpeg_path else None

            ydl_opts = {
                "format": format_selector,
                "outtmpl": outtmpl,
                "progress_hooks": [lambda d: self._progress_hook(task_id, d)],
                "postprocessors": postprocessors,
                "quiet": True,
                "no_warnings": True,
                "merge_output_format": merge_format,
                # We handle sanitization manually via explicit outtmpl
                "restrictfilenames": False, 
            }

            if ffmpeg_location:
                ydl_opts["ffmpeg_location"] = ffmpeg_location
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                
                with self._lock:
                    task = self.tasks[task_id]
                    task.status = DownloadStatus.COMPLETED
                    task.progress = 100.0
                    task.title = info.get("title", "")
                    task.thumbnail = info.get("thumbnail", "")
                    
                    # Construct valid filename using the same logic
                    task.filename = os.path.join(target_dir, f"{safe_title}.{final_ext}")
        
        except Exception as e:
            with self._lock:
                task = self.tasks[task_id]
                task.status = DownloadStatus.ERROR
                task.error = str(e)
        
        # Final callback
        if task_id in self._callbacks:
            self._callbacks[task_id](self.tasks[task_id])
    
    def get_task(self, task_id: str) -> Optional[DownloadTask]:
        """Get task by ID."""
        with self._lock:
            return self.tasks.get(task_id)
    
    def cancel_task(self, task_id: str) -> bool:
        """Cancel a download task."""
        with self._lock:
            task = self.tasks.get(task_id)
            if task and task.status in [DownloadStatus.PENDING, DownloadStatus.DOWNLOADING]:
                task.status = DownloadStatus.ERROR
                task.error = "Cancelled by user"
                return True
            return False
