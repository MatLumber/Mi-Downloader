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


WINDOWS_RESERVED_NAMES = {
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
}


def sanitize_filename(filename: str) -> str:
    """Remove or replace characters that are invalid in Windows filenames."""
    # Characters not allowed in Windows filenames: \ / : * ? " < > |
    invalid_chars = r'[\\/:*?"<>|]'
    sanitized = re.sub(invalid_chars, '_', filename)
    # Also replace any control characters
    sanitized = re.sub(r'[\x00-\x1f]', '', sanitized)
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    sanitized = sanitized.rstrip('. ')

    if not sanitized:
        return "download"

    if sanitized.upper() in WINDOWS_RESERVED_NAMES:
        sanitized = f"file_{sanitized}"

    # Limit filename length (Windows max is 255)
    if len(sanitized) > 200:
        sanitized = sanitized[:200].rstrip('. ')

    return sanitized


_COOKIE_EXTRACT_ERROR_PATTERN = re.compile(
    r"yt-dlp/yt-dlp/issues/7271"
    r"|failed to decrypt with dpapi"
    r"|app[- ]?bound encryption"
    r"|could not copy .* cookies? database"
    r"|could not copy .* cookie database"
    r"|cookies? database is locked"
    r"|winerror 32"
    r"|being used by another process"
    r"|could not find .* cookies? database"
    r"|unable to find .* cookies? database"
    r"|no .* cookies database found"
    r"|could not decrypt the cookie",
    re.IGNORECASE,
)


def _is_cookie_extract_error(exc: BaseException) -> bool:
    """True if the exception is yt-dlp failing to read the chosen browser's cookies.

    This is the trigger for the automatic fallback to the next browser in the chain.
    Non-cookie errors (auth, 403, 404, network, ffmpeg) must NOT match here, otherwise
    we'd waste time trying every browser for an error that has nothing to do with cookies.
    """
    return bool(_COOKIE_EXTRACT_ERROR_PATTERN.search(str(exc)))


def _browser_data_paths() -> Dict[str, str]:
    """Standard cookie-store parent directories on Windows for each browser yt-dlp supports.

    These are the dirs whose presence indicates the browser is *installed* (or at least has
    been launched once). The cookies file inside may not yet exist if the browser is fresh,
    but if the parent dir is missing, the browser definitely won't work as a cookie source.
    """
    local = os.environ.get("LOCALAPPDATA", "")
    roaming = os.environ.get("APPDATA", "")
    return {
        "chrome": os.path.join(local, "Google", "Chrome", "User Data"),
        "edge": os.path.join(local, "Microsoft", "Edge", "User Data"),
        "brave": os.path.join(local, "BraveSoftware", "Brave-Browser", "User Data"),
        "vivaldi": os.path.join(local, "Vivaldi", "User Data"),
        "chromium": os.path.join(local, "Chromium", "User Data"),
        "opera": os.path.join(roaming, "Opera Software", "Opera Stable"),
        "firefox": os.path.join(roaming, "Mozilla", "Firefox", "Profiles"),
    }


def _is_browser_installed(browser: str) -> bool:
    path = _browser_data_paths().get((browser or "").lower().strip())
    return bool(path) and os.path.isdir(path)


def _synced_cookies_default_path() -> str:
    """Path where the companion extension writes its synced cookies.txt.

    Kept identical to the path used by the FastAPI /cookies/sync endpoint so the
    downloader can transparently pick it up without an explicit user setting.
    """
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/AppData/Local")
    return os.path.join(base, "GravityDown", "synced-cookies.txt")


def _build_cookie_fallback_chain(primary: str) -> list:
    """Order of browsers to try if `primary` can't yield cookies.

    Picks the user's chosen browser first, then only the *installed* alternatives. Trying
    non-installed browsers wastes time and surfaces a confusing "could not find chromium
    cookies database" error from a browser the user never selected. Firefox is preferred
    among fallbacks because it sidesteps the Chromium DPAPI/app-bound encryption bug.
    """
    primary = (primary or "").lower().strip()
    candidates = ["firefox", "edge", "chrome", "brave", "vivaldi", "opera", "chromium"]
    chain = [primary] if primary else []
    for c in candidates:
        if c != primary and _is_browser_installed(c):
            chain.append(c)
    return chain


class DownloadCancelled(Exception):
    """Raised from inside a yt-dlp hook to abort an in-flight download.

    yt-dlp catches hook exceptions and stops the download cleanly, deleting any
    .part fragments. The worker's except clause sees this and marks the task as
    cancelled rather than completed.
    """


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
        # Set of task IDs the user has cancelled. The progress/postprocessor hooks
        # check this and raise to abort the in-flight yt-dlp call. Without this,
        # cancel only flipped the visible status to ERROR but yt-dlp kept downloading
        # bytes in its thread, and the worker's success path overwrote ERROR with
        # COMPLETED — making the cancel button effectively a no-op.
        self._cancelled_tasks: set = set()
    
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
        # Cancellation: raise to abort yt-dlp's download loop. yt-dlp catches hook
        # exceptions and aborts cleanly, deleting in-progress .part files.
        if task_id in self._cancelled_tasks:
            raise DownloadCancelled("Cancelled by user")

        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return

            status = d.get("status", "")

            # ANY hook firing means yt-dlp got past extraction and is touching bytes.
            # Always exit FETCHING_INFO so the UI doesn't stay stuck on "Analizando"
            # when yt-dlp's progress throttle skips firing "downloading" for short files.
            if task.status == DownloadStatus.FETCHING_INFO:
                task.status = DownloadStatus.DOWNLOADING

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
                # Don't flip to PROCESSING — _postprocessor_hook handles real merge/
                # convert events. For multi-stream DASH (bestvideo+bestaudio), this
                # fires once per stream and we want to keep showing DOWNLOADING for
                # the next stream.
                task.progress = 100.0
                task.filename = d.get("filename", "")

            elif status == "error":
                task.status = DownloadStatus.ERROR
                task.error = str(d.get("error", "Unknown error"))

        # Notify callback
        if task_id in self._callbacks:
            self._callbacks[task_id](task)

    def _postprocessor_hook(self, task_id: str, d: Dict[str, Any]) -> None:
        """yt-dlp post-processor hook — fires for ffmpeg merge / format conversion / etc."""
        if task_id in self._cancelled_tasks:
            raise DownloadCancelled("Cancelled by user")

        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return
            status = d.get("status", "")
            # 'started' fires when a post-processor (merge, convert) begins.
            if status == "started":
                task.status = DownloadStatus.PROCESSING
                task.progress = 100.0
        if task_id in self._callbacks:
            self._callbacks[task_id](task)
    
    def get_video_info(self, url: str) -> Dict[str, Any]:
        """Fetch video or playlist metadata without downloading."""
        url = self._normalize_url(url)
        is_playlist_url = ("list=" in url) or ("/playlist" in url)
        platform = self._detect_platform(url)

        # For playlists we use extract_flat='in_playlist' to get all entries fast
        # without resolving each video's full format ladder.
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist" if is_playlist_url else False,
            "skip_download": True,
            "socket_timeout": 20,
            "extractor_args": {
                "youtube": {
                    "player_client": ["web", "web_safari", "android_vr"],
                }
            },
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            if not info:
                raise ValueError("Could not extract video info")

            is_playlist = info.get("_type") == "playlist" or bool(info.get("entries"))

            if is_playlist:
                raw_entries = info.get("entries") or []
                entries = []
                for entry in raw_entries:
                    if not entry:
                        continue
                    eid = entry.get("id") or ""
                    entry_url = (
                        entry.get("webpage_url")
                        or entry.get("url")
                        or (f"https://www.youtube.com/watch?v={eid}" if eid and platform == "youtube" else "")
                    )
                    if not entry_url:
                        continue
                    duration = entry.get("duration")
                    if isinstance(duration, float):
                        duration = int(duration)
                    thumbnail = entry.get("thumbnail")
                    if not thumbnail and platform == "youtube" and eid:
                        thumbnail = f"https://i.ytimg.com/vi/{eid}/hqdefault.jpg"
                    entries.append({
                        "id": eid,
                        "title": entry.get("title") or "Sin título",
                        "url": entry_url,
                        "thumbnail": thumbnail,
                        "duration": duration,
                    })

                playlist_thumb = info.get("thumbnail")
                if not playlist_thumb and entries:
                    playlist_thumb = entries[0].get("thumbnail")

                return {
                    "id": info.get("id") or "",
                    "title": info.get("title") or "Playlist",
                    "thumbnail": playlist_thumb,
                    "duration": None,
                    "channel": info.get("channel") or info.get("uploader"),
                    "view_count": None,
                    "platform": platform,
                    "formats": [],
                    "is_playlist": True,
                    "playlist_count": len(entries),
                    "entries": entries,
                }

            # Single video — extract format ladder
            formats = []
            seen_resolutions = set()

            for f in info.get("formats", []):
                height = f.get("height")
                vcodec = f.get("vcodec", "none")
                acodec = f.get("acodec", "none")

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
                "platform": platform,
                "formats": formats,
                "is_playlist": False,
                "playlist_count": 0,
                "entries": [],
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
        use_cookies: bool = False,
        cookies_browser: Optional[str] = None,
        cookies_file: Optional[str] = None,
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
        self.executor.submit(
            self._download_worker, task_id, url, format_type, quality,
            output_path, output_format, audio_quality, use_cookies, cookies_browser, cookies_file,
        )

        return task_id

    def _download_worker(
        self,
        task_id: str,
        url: str,
        format_type: str,
        quality: str,
        output_path: Optional[str] = None,
        output_format: Optional[str] = None,
        audio_quality: Optional[str] = None,
        use_cookies: bool = False,
        cookies_browser: Optional[str] = None,
        cookies_file: Optional[str] = None,
    ) -> None:
        """Worker thread for downloading."""

        try:
            with self._lock:
                task = self.tasks[task_id]
                task.status = DownloadStatus.FETCHING_INFO
            
            # Use custom output path or default
            target_dir = output_path or self.output_dir
            target_dir = os.path.expanduser(os.path.expandvars(target_dir))
            target_dir = os.path.abspath(target_dir)
            os.makedirs(target_dir, exist_ok=True)
            
            # PRE-FETCH INFO to determine title and ensure consistency
            # This is crucial to avoid mismatch between yt-dlp's sanitization and ours
            pre_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,
                "socket_timeout": 20,
                "retries": 5,
                "extractor_retries": 3,
                "extractor_args": {
                    "youtube": {
                        "player_client": ["web", "web_safari", "android_vr"],
                    }
                },
            }
            with yt_dlp.YoutubeDL(pre_opts) as ydl_pre:
                try:
                    pre_info = ydl_pre.extract_info(url, download=False)
                    # Sanitize title strictly using our function
                    safe_title = sanitize_filename(pre_info.get('title', 'download'))
                except Exception:
                    # Fallback if pre-fetch fails
                    safe_title = f"download_{task_id}"

            if not safe_title:
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
                
                # Permissive fallback chain: prefer separate DASH (best quality), then any
                # combined format, then video-only or audio-only as last-ditch attempts.
                # Prevents "Requested format is not available" when YouTube returns a
                # stripped manifest where some categories are missing.
                if quality == "best":
                    format_selector = (
                        "bestvideo+bestaudio/best/bestvideo/bestaudio"
                    )
                else:
                    height = quality.replace("p", "")
                    format_selector = (
                        f"bestvideo[height<={height}]+bestaudio"
                        f"/best[height<={height}]"
                        f"/bestvideo[height<={height}]"
                        f"/bestvideo+bestaudio"
                        f"/best"
                    )
                
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

            # Clean stale partial artifacts from previous failed runs for this same title.
            # yt-dlp resumes from .part files by default; a corrupted .part from a prior
            # timeout produces silent audio corruption ("shhshhshs") in the merged output.
            # Removing them forces a clean fragment-by-fragment download.
            try:
                for entry in os.listdir(target_dir):
                    if not entry.startswith(safe_title):
                        continue
                    if entry.endswith((".part", ".ytdl", ".part-Frag")) or ".part-Frag" in entry:
                        try:
                            os.remove(os.path.join(target_dir, entry))
                        except OSError:
                            pass
            except OSError:
                pass

            ffmpeg_path = self._find_binary("ffmpeg.exe", "FFMPEG_PATH") or self._find_binary("ffmpeg", "FFMPEG_PATH")
            ffmpeg_location = os.path.dirname(ffmpeg_path) if ffmpeg_path else None

            ydl_opts = {
                "format": format_selector,
                "outtmpl": outtmpl,
                "progress_hooks": [lambda d: self._progress_hook(task_id, d)],
                "postprocessor_hooks": [lambda d: self._postprocessor_hook(task_id, d)],
                "postprocessors": postprocessors,
                "quiet": True,
                "no_warnings": True,
                "merge_output_format": merge_format,
                # We handle sanitization manually via explicit outtmpl
                "restrictfilenames": False,
                # Network resilience: YouTube serves DASH fragments; transient socket
                # timeouts on a single fragment must not abort the whole download.
                "socket_timeout": 30,
                "retries": 10,
                "fragment_retries": 10,
                "extractor_retries": 5,
                "file_access_retries": 5,
                "retry_sleep_functions": {
                    "http": lambda n: min(4 * (2 ** n), 60),
                    "fragment": lambda n: min(2 * (2 ** n), 30),
                    "extractor": lambda n: min(2 * (2 ** n), 30),
                },
                # YouTube player-client list — explicitly enumerated so we DON'T
                # implicitly include the broken ones. The "default" group currently
                # includes ios_downgraded, which YouTube has been rejecting with
                # HTTP 400 "Precondition check failed" (it requires a PO Token that
                # yt-dlp can't synthesize without a real device). yt-dlp then burns
                # ~60 seconds in exponential-backoff retries (2+4+8+16+32s) against
                # a perma-failing endpoint, during which no progress hook fires —
                # producing the "stuck in Analizando" symptom. We pick three
                # clients that work without a PO Token:
                #   - web         : standard desktop web extractor
                #   - web_safari  : alternate web client, helps when web is blocked
                #   - android_vr  : reliably returns formats; doesn't need PO Token
                "extractor_args": {
                    "youtube": {
                        "player_client": ["web", "web_safari", "android_vr"],
                    }
                },
            }

            if ffmpeg_location:
                ydl_opts["ffmpeg_location"] = ffmpeg_location

            # Cookies resolution priority:
            #   1. cookies_file (Netscape format) — bypasses ALL browser-store encryption,
            #      including Chrome 127+'s app-bound encryption (yt-dlp issue 7271). User
            #      exports once via a "Get cookies.txt" extension, then it just works.
            #   2. cookiesfrombrowser with installed-only fallback chain — the user's chosen
            #      browser first, then any other installed browser. Non-installed browsers
            #      are skipped to avoid confusing "could not find X cookies database" errors.
            cookies_file_path = None
            if cookies_file:
                expanded = os.path.expanduser(os.path.expandvars(cookies_file))
                if os.path.isfile(expanded):
                    cookies_file_path = expanded

            # If the user has cookies enabled but didn't pick a manual file, transparently
            # use whatever the GravityDown Companion extension last synced. This is the
            # path that makes Chrome 127+ "just work" — the extension sidesteps app-bound
            # encryption by reading via chrome.cookies and POSTing here.
            if not cookies_file_path and use_cookies:
                synced = _synced_cookies_default_path()
                if os.path.isfile(synced):
                    cookies_file_path = synced

            if cookies_file_path:
                # Single attempt with cookiefile — no fallback chain needed because cookie
                # files don't have decryption issues.
                attempt_opts = dict(ydl_opts)
                attempt_opts["cookiefile"] = cookies_file_path
                with yt_dlp.YoutubeDL(attempt_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
            else:
                valid_browsers = {"chrome", "firefox", "edge", "brave", "opera", "vivaldi", "chromium", "safari"}
                primary_browser = cookies_browser.lower().strip() if (use_cookies and cookies_browser) else None
                if primary_browser not in valid_browsers:
                    primary_browser = None

                if primary_browser:
                    browsers_to_try = _build_cookie_fallback_chain(primary_browser)
                else:
                    browsers_to_try = [None]  # no cookies at all

                info = None
                first_cookie_error: Optional[Exception] = None
                last_error: Optional[Exception] = None

                for attempt_browser in browsers_to_try:
                    attempt_opts = dict(ydl_opts)
                    if attempt_browser:
                        attempt_opts["cookiesfrombrowser"] = (attempt_browser,)
                    else:
                        attempt_opts.pop("cookiesfrombrowser", None)

                    try:
                        with yt_dlp.YoutubeDL(attempt_opts) as ydl:
                            info = ydl.extract_info(url, download=True)
                        last_error = None
                        break
                    except Exception as exc:
                        last_error = exc
                        # Only fall back to the next browser when this specific error is about
                        # not being able to read THIS browser's cookies. Anything else (auth,
                        # 403, video not found, network) gets surfaced directly.
                        if attempt_browser and _is_cookie_extract_error(exc):
                            if first_cookie_error is None:
                                first_cookie_error = exc
                            continue
                        raise

                if last_error is not None:
                    # Surface the FIRST cookie-extract error (from the user's chosen browser).
                    # The last attempt may have been a fallback browser that produced a less
                    # helpful "could not find X cookies database" message.
                    raise first_cookie_error or last_error

            if info is None:
                raise RuntimeError("yt-dlp returned no info dict")

            with self._lock:
                task = self.tasks[task_id]
                # Don't overwrite a cancellation that landed during the final
                # moments — e.g. user clicked cancel while extract_info was
                # already returning. The hook may not have raised in time.
                if task_id not in self._cancelled_tasks:
                    task.status = DownloadStatus.COMPLETED
                    task.progress = 100.0
                    task.title = info.get("title", "")
                    task.thumbnail = info.get("thumbnail", "")
                    task.filename = os.path.join(target_dir, f"{safe_title}.{final_ext}")

        except DownloadCancelled:
            # Raised from inside our hook — yt-dlp aborted cleanly. Status was
            # already set by cancel_task(); just don't overwrite it.
            pass
        except Exception as e:
            with self._lock:
                task = self.tasks[task_id]
                # Same defense — if the user cancelled, surface the cancel
                # message even if yt-dlp's internal error path got there first.
                if task_id in self._cancelled_tasks:
                    task.status = DownloadStatus.ERROR
                    task.error = "Cancelled by user"
                else:
                    task.status = DownloadStatus.ERROR
                    task.error = str(e)
        finally:
            # Drop the cancellation marker so the same task_id (unlikely but
            # possible — we use 8-char UUID prefixes) doesn't carry over.
            self._cancelled_tasks.discard(task_id)

        # Final callback
        if task_id in self._callbacks:
            self._callbacks[task_id](self.tasks[task_id])
    
    def get_task(self, task_id: str) -> Optional[DownloadTask]:
        """Get task by ID."""
        with self._lock:
            return self.tasks.get(task_id)
    
    def cancel_task(self, task_id: str) -> bool:
        """Cancel a download task.

        Marks the task in `_cancelled_tasks` so the next progress/postprocessor
        hook fire raises and aborts yt-dlp. Also flips visible status to ERROR
        immediately so the UI reflects the cancel without waiting for the next
        hook to run. The worker's except clause won't overwrite this because it
        checks the cancelled set before marking COMPLETED.
        """
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False
            # Allow cancelling from any active phase, including FETCHING_INFO and
            # PROCESSING (post-processing — ffmpeg merge in progress).
            cancellable = {
                DownloadStatus.PENDING,
                DownloadStatus.FETCHING_INFO,
                DownloadStatus.DOWNLOADING,
                DownloadStatus.PROCESSING,
            }
            if task.status not in cancellable:
                return False
            self._cancelled_tasks.add(task_id)
            task.status = DownloadStatus.ERROR
            task.error = "Cancelled by user"
            return True
