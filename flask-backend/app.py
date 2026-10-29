"""
ClipFetch - Python Flask Backend with pytubefix
Production-ready YouTube video and audio extraction and conversion API.
Deployable on Render, Railway, Fly.io, Heroku, Google Cloud Run, or AWS.
"""

import os
import re
import time
import uuid
import shutil
import logging
import threading
import subprocess
from urllib.parse import urlparse
from typing import Dict, Any, Optional, List

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("clipfetch-flask")

app = Flask(__name__)

# Security: Controlled CORS configuration
ALLOWED_ORIGINS_ENV = os.getenv("CORS_ORIGIN", "")
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS_ENV.split(",") if o.strip()]

if not ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS:
    # Wildcard origin cannot be used with credentials
    CORS(
        app,
        resources={r"/api/*": {"origins": "*"}},
        supports_credentials=False,
        methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization"]
    )
else:
    CORS(
        app,
        resources={r"/api/*": {"origins": ALLOWED_ORIGINS}},
        supports_credentials=True,
        methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization"]
    )

# Configuration
TEMP_DIR = os.path.abspath(os.getenv("TEMP_DIR", "/tmp/clipfetch_flask"))
os.makedirs(TEMP_DIR, exist_ok=True)
DOWNLOAD_TIMEOUT_SECONDS = int(os.getenv("DOWNLOAD_TIMEOUT_SECONDS", "120"))
TICKET_EXPIRATION_SECONDS = int(os.getenv("TICKET_EXPIRATION_SECONDS", "300"))

# SSRF Protection: Allowed domains
ALLOWED_DOMAINS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be"
}

ALLOWED_BITRATES = {48, 64, 96, 128, 160, 192, 256, 320}

# In-memory download tickets
# Format: {ticket_id: {"file_path": str, "download_name": str, "mimetype": str, "created_at": float}}
tickets: Dict[str, Dict[str, Any]] = {}
tickets_lock = threading.Lock()


def is_safe_url(url: str) -> bool:
    """Validate that the URL belongs strictly to supported YouTube domains with SSRF defenses."""
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        if parsed.username or parsed.password:
            return False
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False
        # Reject private/internal IP patterns and loopbacks
        if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"):
            return False
        if (
            hostname.startswith("10.") or
            hostname.startswith("192.168.") or
            hostname.startswith("172.") or
            hostname.endswith(".local") or
            hostname.endswith(".internal")
        ):
            return False
        # Match strictly allowed domains
        return any(hostname == d or hostname.endswith("." + d) for d in ALLOWED_DOMAINS)
    except Exception:
        return False


def sanitize_download_filename(name: str, fallback: str = "ClipFetch_Video", ext: str = "mp4") -> str:
    """Sanitize attachment filename for the browser Content-Disposition header."""
    if not name:
        return f"{fallback}.{ext}"
    cleaned = re.sub(r'[\\/*?:"<>|\r\n\t]', "", name)
    cleaned = re.sub(r"\s+", "_", cleaned.strip())
    if len(cleaned) > 80:
        cleaned = cleaned[:77] + "..."
    if not cleaned:
        cleaned = fallback
    return f"{cleaned}.{ext}"


def delayed_cleanup(dir_path: str, ticket_id: str, delay: int = 30):
    """Clean up temporary directory and tickets after delivery."""
    def worker():
        time.sleep(delay)
        with tickets_lock:
            tickets.pop(ticket_id, None)
        try:
            temp_dir_abs = os.path.abspath(TEMP_DIR)
            dir_abs = os.path.abspath(dir_path)
            # Ensure path is safely within TEMP_DIR before removing
            if dir_abs.startswith(temp_dir_abs + os.sep) and os.path.isdir(dir_abs):
                shutil.rmtree(dir_abs, ignore_errors=True)
                logger.info(f"Cleaned up temporary directory: {dir_abs}")
        except Exception as e:
            logger.warning(f"Error deleting temp dir {dir_path}: {e}")

    threading.Thread(target=worker, daemon=True).start()


def get_quality_label(height: int) -> str:
    """Standardized quality label."""
    if height >= 2160:
        return "2160p (4K)"
    if height >= 1440:
        return "1440p (2K)"
    if height >= 1080:
        return "1080p (Full HD)"
    if height >= 720:
        return "720p (HD)"
    if height >= 480:
        return "480p (SD)"
    if height >= 360:
        return "360p"
    if height >= 240:
        return "240p"
    return f"{height}p"


def get_standard_resolution(height: int) -> str:
    """Standardized resolution string."""
    if height >= 2160:
        return "3840x2160"
    if height >= 1440:
        return "2560x1440"
    if height >= 1080:
        return "1920x1080"
    if height >= 720:
        return "1280x720"
    if height >= 480:
        return "854x480"
    if height >= 360:
        return "640x360"
    if height >= 240:
        return "426x240"
    return f"{int(height * 16 / 9)}x{height}"


def format_filesize(size_bytes: Optional[int]) -> Optional[str]:
    """Convert bytes to human-readable size string."""
    if not size_bytes or size_bytes <= 0:
        return None
    mb = size_bytes / (1024 * 1024)
    if mb >= 1024:
        return f"{mb / 1024:.2f} GB"
    return f"{mb:.1f} MB"


# ============================================================================
# API Routes
# ============================================================================

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "ClipFetch Flask pytubefix API",
        "status": "operational",
        "version": "1.0.0",
        "endpoints": {
            "health": "/api/health",
            "analyze": "/api/analyze",
            "video_info": "/api/video-info",
            "download": "/api/download"
        }
    })


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint exposing dependency availability."""
    ffmpeg_available = shutil.which("ffmpeg") is not None
    ffprobe_available = shutil.which("ffprobe") is not None
    pytubefix_available = False
    try:
        import pytubefix  # noqa: F401
        pytubefix_available = True
    except ImportError:
        pass

    return jsonify({
        "success": True,
        "data": {
            "status": "operational",
            "version": "1.0.0",
            "service": "ClipFetch Flask pytubefix API",
            "supportedPlatforms": ["youtube"],
            "dependencies": {
                "pytubefix": pytubefix_available,
                "ffmpeg": ffmpeg_available,
                "ffprobe": ffprobe_available
            },
            "features": [
                "youtube_pytubefix_extraction",
                "progressive_mp4_downloads",
                "adaptive_1080p_merging",
                "mp3_audio_extraction",
                "ssrf_protection"
            ]
        }
    })


@app.route("/api/analyze", methods=["POST"])
@app.route("/api/video-info", methods=["POST"])
def analyze():
    """Extract metadata, available resolutions, and audio options via pytubefix."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    if not url:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_INPUT", "message": "A valid video URL is required."}
        }), 400

    if not is_safe_url(url):
        return jsonify({
            "success": False,
            "error": {
                "code": "UNSUPPORTED_DOMAIN",
                "message": "Only public YouTube URLs are supported by this pytubefix backend."
            }
        }), 400

    try:
        from pytubefix import YouTube
        from pytubefix.exceptions import VideoUnavailable, RegexMatchError
    except ImportError:
        return jsonify({
            "success": False,
            "error": {
                "code": "DEPENDENCY_ERROR",
                "message": "pytubefix library is not installed on this server."
            }
        }), 500

    try:
        yt = YouTube(url, client='WEB')
        title = yt.title or "YouTube Video"
        if len(title) > 190:
            title = title[:187] + "..."
        thumbnail = yt.thumbnail_url or None
        author = yt.author or "YouTube Creator"
        duration = yt.length or 0

        streams = yt.streams
        seen_heights = set()
        video_formats: List[Dict[str, Any]] = []

        progressive_streams = streams.filter(progressive=True, file_extension='mp4')
        for stream in progressive_streams:
            res_str = stream.resolution or ""
            height_match = re.search(r"(\d{3,4})", res_str)
            if not height_match:
                continue
            height = int(height_match.group(1))
            if height in seen_heights or height < 144:
                continue
            seen_heights.add(height)
            try:
                filesize = stream.filesize
            except Exception:
                filesize = None

            video_formats.append({
                "id": f"yt-{stream.itag}-{height}p",
                "itag": stream.itag,
                "format": "MP4",
                "quality": get_quality_label(height),
                "resolution": get_standard_resolution(height),
                "height": height,
                "filesize": filesize,
                "filesizeFormatted": format_filesize(filesize),
                "url": url,
                "hasAudio": True,
                "hasVideo": True,
                "isHd": height >= 720,
                "isAdaptive": False,
                "mediaType": "video"
            })

        adaptive_streams = streams.filter(adaptive=True, only_video=True, file_extension='mp4')
        for stream in adaptive_streams:
            res_str = stream.resolution or ""
            height_match = re.search(r"(\d{3,4})", res_str)
            if not height_match:
                continue
            height = int(height_match.group(1))
            if height in seen_heights or height < 144:
                continue
            seen_heights.add(height)
            try:
                filesize = stream.filesize
            except Exception:
                filesize = None

            video_formats.append({
                "id": f"yt-{stream.itag}-{height}p",
                "itag": stream.itag,
                "format": "MP4",
                "quality": get_quality_label(height),
                "resolution": get_standard_resolution(height),
                "height": height,
                "filesize": filesize,
                "filesizeFormatted": format_filesize(filesize),
                "url": url,
                "hasAudio": True,
                "hasVideo": True,
                "isHd": height >= 720,
                "isAdaptive": True,
                "mediaType": "video"
            })

        video_formats.sort(key=lambda x: x["height"])

        audio_options = [
            {
                "id": "audio-mp3-48k",
                "format": "MP3",
                "quality": "48 kbps",
                "audioBitrate": 48,
                "isAudio": True,
                "mediaType": "audio",
                "filesizeFormatted": f"~{max(0.5, round(((48 * 1000 / 8) * duration) / (1024 * 1024) * 10) / 10):.1f} MB" if duration else None,
                "url": url
            },
            {
                "id": "audio-mp3-128k",
                "format": "MP3",
                "quality": "128 kbps",
                "audioBitrate": 128,
                "isAudio": True,
                "mediaType": "audio",
                "filesizeFormatted": f"~{max(0.5, round(((128 * 1000 / 8) * duration) / (1024 * 1024) * 10) / 10):.1f} MB" if duration else None,
                "url": url
            },
            {
                "id": "audio-mp3-320k",
                "format": "MP3",
                "quality": "320 kbps",
                "audioBitrate": 320,
                "isAudio": True,
                "mediaType": "audio",
                "filesizeFormatted": f"~{max(1.0, round(((320 * 1000 / 8) * duration) / (1024 * 1024) * 10) / 10):.1f} MB" if duration else None,
                "url": url
            }
        ]

        minutes = duration // 60
        seconds = duration % 60
        duration_formatted = f"{minutes}:{seconds:02d}"

        result_payload = {
            "success": True,
            "platform": "youtube",
            "platformLabel": "YouTube",
            "id": yt.video_id,
            "title": title,
            "author": author,
            "thumbnail": thumbnail,
            "duration": duration,
            "durationFormatted": duration_formatted,
            "formats": video_formats,
            "audio_options": audio_options,
            "downloadAvailable": len(video_formats) > 0,
            "originalUrl": url
        }

        return jsonify({
            **result_payload,
            "data": result_payload
        })

    except VideoUnavailable:
        return jsonify({
            "success": False,
            "error": {
                "code": "VIDEO_UNAVAILABLE",
                "message": "This YouTube video is private, deleted, or region-restricted."
            }
        }), 404
    except RegexMatchError:
        return jsonify({
            "success": False,
            "error": {
                "code": "INVALID_URL",
                "message": "The provided URL is not a recognized YouTube video link."
            }
        }), 400
    except Exception as e:
        logger.error(f"Error extracting video info: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": {
                "code": "EXTRACTION_FAILED",
                "message": "Failed to extract video details. Please verify the URL and try again."
            }
        }), 502


@app.route("/api/download", methods=["POST"])
def download():
    """Download video or audio using pytubefix and prepare downloadable file."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    if not url:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_INPUT", "message": "URL is required for download."}
        }), 400

    if not is_safe_url(url):
        return jsonify({
            "success": False,
            "error": {"code": "UNSUPPORTED_DOMAIN", "message": "Only public YouTube URLs are supported."}
        }), 400

    media_type = data.get("mediaType") or data.get("type") or "video"
    format_id = str(data.get("formatId") or data.get("format_id") or "")

    # Security: Strictly validate bitrate against allowed integer set
    try:
        raw_bitrate = int(data.get("audioBitrate") or data.get("bitrate") or 128)
    except (ValueError, TypeError):
        raw_bitrate = 128
    bitrate = raw_bitrate if raw_bitrate in ALLOWED_BITRATES else 128

    raw_title = str(data.get("title") or "video")

    try:
        from pytubefix import YouTube
    except ImportError:
        return jsonify({
            "success": False,
            "error": {"code": "DEPENDENCY_ERROR", "message": "pytubefix is not installed."}
        }), 500

    # Security: Generate clean, random directory inside TEMP_DIR
    ticket_id = str(uuid.uuid4())
    ticket_dir = os.path.join(TEMP_DIR, ticket_id)
    os.makedirs(ticket_dir, exist_ok=True)

    try:
        yt = YouTube(url, client='WEB')
        streams = yt.streams

        if media_type == "audio":
            audio_stream = streams.filter(only_audio=True).order_by('abr').desc().first()
            if not audio_stream:
                audio_stream = streams.filter(only_audio=True).first()
            if not audio_stream:
                return jsonify({
                    "success": False,
                    "error": {"code": "NO_AUDIO_STREAM", "message": "No audio stream available for this video."}
                }), 404

            # Security: Use fixed internal file paths to prevent uncontrolled path expressions
            temp_audio_file = os.path.join(ticket_dir, "raw_audio.m4a")
            audio_stream.download(output_path=ticket_dir, filename="raw_audio.m4a")

            final_output_path = os.path.join(ticket_dir, "output.mp3")
            safe_download_name = sanitize_download_filename(raw_title, "ClipFetch_Audio", f"{bitrate}kbps.mp3")

            ffmpeg_path = shutil.which("ffmpeg")
            if ffmpeg_path:
                # Security: Controlled command arguments with fixed binary, integers, and paths
                cmd = [
                    ffmpeg_path, "-y",
                    "-i", temp_audio_file,
                    "-vn",
                    "-ar", "44100",
                    "-ac", "2",
                    "-b:a", f"{bitrate}k",
                    final_output_path
                ]
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                mimetype = "audio/mpeg"
            else:
                final_output_path = os.path.join(ticket_dir, "output.m4a")
                safe_download_name = sanitize_download_filename(raw_title, "ClipFetch_Audio", "m4a")
                os.rename(temp_audio_file, final_output_path)
                mimetype = "audio/mp4"

        else:
            chosen_stream = None

            itag_match = re.search(r"yt-(\d+)", format_id)
            if itag_match:
                itag_val = int(itag_match.group(1))
                chosen_stream = streams.get_by_itag(itag_val)

            if not chosen_stream:
                res_match = re.search(r"(\d{3,4})p?", format_id)
                target_res = f"{res_match.group(1)}p" if res_match else "720p"
                chosen_stream = streams.filter(res=target_res, file_extension='mp4').first()

            if not chosen_stream:
                chosen_stream = streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()

            if not chosen_stream:
                return jsonify({
                    "success": False,
                    "error": {"code": "NO_VIDEO_STREAM", "message": "No suitable video stream found."}
                }), 404

            # Security: Use fixed internal file path
            final_output_path = os.path.join(ticket_dir, "output.mp4")
            safe_download_name = sanitize_download_filename(raw_title, "ClipFetch_Video", "mp4")

            if chosen_stream.is_progressive:
                chosen_stream.download(output_path=ticket_dir, filename="output.mp4")
            else:
                video_temp = os.path.join(ticket_dir, "video_stream.mp4")
                chosen_stream.download(output_path=ticket_dir, filename="video_stream.mp4")

                best_audio = streams.filter(only_audio=True).order_by('abr').desc().first()
                ffmpeg_path = shutil.which("ffmpeg")

                if best_audio and ffmpeg_path:
                    audio_temp = os.path.join(ticket_dir, "audio_stream.m4a")
                    best_audio.download(output_path=ticket_dir, filename="audio_stream.m4a")

                    # Security: Controlled command execution with strict arguments
                    merge_cmd = [
                        ffmpeg_path, "-y",
                        "-i", video_temp,
                        "-i", audio_temp,
                        "-c:v", "copy",
                        "-c:a", "aac",
                        "-movflags", "+faststart",
                        final_output_path
                    ]
                    try:
                        subprocess.run(merge_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
                    except Exception:
                        return jsonify({
                            "success": False,
                            "error": {"code": "AUDIO_MERGE_FAILED", "message": "Failed to merge video and audio streams into playable media."}
                        }), 502
                else:
                    return jsonify({
                        "success": False,
                        "error": {"code": "AUDIO_MERGE_FAILED", "message": "Separate audio stream or FFmpeg is unavailable to assemble complete video with sound."}
                    }), 502

            mimetype = "video/mp4"

        # Verify output exists
        if not os.path.exists(final_output_path) or os.path.getsize(final_output_path) == 0:
            return jsonify({
                "success": False,
                "error": {"code": "DOWNLOAD_FAILED", "message": "Failed to assemble the downloaded media file."}
            }), 500

        with tickets_lock:
            tickets[ticket_id] = {
                "file_path": final_output_path,
                "download_name": safe_download_name,
                "mimetype": mimetype,
                "created_at": time.time()
            }

        download_relative_url = f"/api/download-file/{ticket_id}"

        response_data = {
            "success": True,
            "download_id": ticket_id,
            "downloadUrl": download_relative_url,
            "filename": safe_download_name,
            "data": {
                "download_id": ticket_id,
                "downloadUrl": download_relative_url,
                "filename": safe_download_name
            }
        }

        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Download processing failed: {e}", exc_info=True)
        shutil.rmtree(ticket_dir, ignore_errors=True)
        return jsonify({
            "success": False,
            "error": {
                "code": "DOWNLOAD_ERROR",
                "message": "Failed to process download. Please check the video URL and try again."
            }
        }), 502


@app.route("/api/download-file/<ticket_id>", methods=["GET"])
def stream_file(ticket_id: str):
    """Serve the generated file safely and schedule its cleanup."""
    # Security: Validate ticket_id pattern strictly to avoid path traversal
    if not re.match(r"^[0-9a-fA-F-]{36}$", ticket_id):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_ID", "message": "Invalid download ticket identifier."}
        }), 400

    with tickets_lock:
        ticket = tickets.get(ticket_id)

    if not ticket:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "Download link expired or invalid."}
        }), 404

    file_path = os.path.abspath(ticket["file_path"])
    temp_dir_abs = os.path.abspath(TEMP_DIR)

    # Security: Verify that the target file is strictly confined within TEMP_DIR
    if not file_path.startswith(temp_dir_abs + os.sep) or not os.path.exists(file_path):
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "File not found or access restricted."}
        }), 404

    download_name = ticket["download_name"]
    mimetype = ticket.get("mimetype", "application/octet-stream")

    # Schedule deferred cleanup after download finishes
    delayed_cleanup(os.path.dirname(file_path), ticket_id, delay=60)

    return send_file(
        file_path,
        as_attachment=True,
        download_name=download_name,
        mimetype=mimetype,
        max_age=0
    )


# ============================================================================
# Server Runner
# ============================================================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("HOST", "0.0.0.0")
    debug = os.getenv("FLASK_ENV") == "development"
    logger.info(f"Starting ClipFetch Flask pytubefix API on http://{host}:{port}")
    app.run(host=host, port=port, debug=debug)
