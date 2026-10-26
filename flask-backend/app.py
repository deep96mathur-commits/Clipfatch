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

from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("clipfetch-flask")

app = Flask(__name__)

# Enable CORS for frontend requests
ALLOWED_ORIGINS = os.getenv("CORS_ORIGIN", "*").split(",")
CORS(
    app,
    resources={r"/api/*": {"origins": ALLOWED_ORIGINS if ALLOWED_ORIGINS != ["*"] else "*"}},
    supports_credentials=True,
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"]
)

# Configuration
TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/clipfetch_flask")
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

# In-memory download tickets
# Format: {ticket_id: {"file_path": str, "filename": str, "mimetype": str, "created_at": float}}
tickets: Dict[str, Dict[str, Any]] = {}
tickets_lock = threading.Lock()


def is_safe_url(url: str) -> bool:
    """Validate that the URL belongs strictly to supported YouTube domains."""
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False
        # Reject private/internal IP patterns
        if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"):
            return False
        if hostname.startswith("10.") or hostname.startswith("192.168.") or hostname.startswith("172."):
            return False
        # Match allowed domain
        return any(hostname == d or hostname.endswith("." + d) for d in ALLOWED_DOMAINS)
    except Exception:
        return False


def sanitize_filename(name: str) -> str:
    """Sanitize filename to prevent directory traversal and remove illegal chars."""
    if not name:
        return "ClipFetch_Video"
    # Remove directory separators and dangerous characters
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r"\s+", "_", cleaned.strip())
    # Cap length to 100 characters
    if len(cleaned) > 100:
        cleaned = cleaned[:97] + "..."
    return cleaned or "ClipFetch_Video"


def delayed_cleanup(file_path: str, ticket_id: str, delay: int = 30):
    """Clean up temporary files after delivery."""
    def worker():
        time.sleep(delay)
        with tickets_lock:
            tickets.pop(ticket_id, None)
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Cleaned up temporary file: {file_path}")
        except Exception as e:
            logger.warning(f"Error deleting temp file {file_path}: {e}")

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
    
    # Check pytubefix import
    pytubefix_available = False
    try:
        import pytubefix
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
        from pytubefix.exceptions import VideoUnavailable, RegexMatchError, ExtractError
    except ImportError:
        return jsonify({
            "success": False,
            "error": {
                "code": "DEPENDENCY_ERROR",
                "message": "pytubefix library is not installed on this server. Run: pip install pytubefix"
            }
        }), 500

    try:
        # Initialize YouTube with WEB client for highest reliability
        yt = YouTube(url, client='WEB')
        
        # Extract basic metadata
        title = yt.title or "YouTube Video"
        if len(title) > 190:
            title = title[:187] + "..."

        thumbnail = yt.thumbnail_url or None
        author = yt.author or "YouTube Creator"
        duration = yt.length or 0

        # Discover available video formats
        streams = yt.streams
        seen_heights = set()
        video_formats: List[Dict[str, Any]] = []

        # 1. Progressive streams (contain both audio and video, typical for 720p and 360p)
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

        # 2. Adaptive streams (e.g. 1080p, 1440p, 2160p Full HD video streams)
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
                "hasAudio": True,  # Will be muxed with audio on download via ffmpeg
                "hasVideo": True,
                "isHd": height >= 720,
                "isAdaptive": True,
                "mediaType": "video"
            })

        # Sort video formats ascending by height (360p -> 720p -> 1080p)
        video_formats.sort(key=lambda x: x["height"])

        # Audio options
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

        # Return both top-level and data wrapper for full client compatibility
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
                "message": f"Failed to extract video details: {str(e)}"
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
    format_id = data.get("formatId") or data.get("format_id") or ""
    bitrate = data.get("audioBitrate") or data.get("bitrate") or 128
    raw_title = data.get("title") or "video"
    safe_title = sanitize_filename(raw_title)

    try:
        from pytubefix import YouTube
    except ImportError:
        return jsonify({
            "success": False,
            "error": {"code": "DEPENDENCY_ERROR", "message": "pytubefix is not installed."}
        }), 500

    ticket_id = str(uuid.uuid4())
    ticket_dir = os.path.join(TEMP_DIR, ticket_id)
    os.makedirs(ticket_dir, exist_ok=True)

    try:
        yt = YouTube(url, client='WEB')
        streams = yt.streams

        if media_type == "audio":
            # Audio-only extraction and MP3 conversion
            audio_stream = streams.filter(only_audio=True).order_by('abr').desc().first()
            if not audio_stream:
                audio_stream = streams.filter(only_audio=True).first()
            if not audio_stream:
                return jsonify({
                    "success": False,
                    "error": {"code": "NO_AUDIO_STREAM", "message": "No audio stream available for this video."}
                }), 404

            temp_audio_file = os.path.join(ticket_dir, "raw_audio.m4a")
            audio_stream.download(output_path=ticket_dir, filename="raw_audio.m4a")

            final_filename = f"ClipFetch_{safe_title}_{bitrate}kbps.mp3"
            final_output_path = os.path.join(ticket_dir, final_filename)

            # Convert to MP3 using ffmpeg if available
            ffmpeg_path = shutil.which("ffmpeg")
            if ffmpeg_path:
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
                # Fallback to serving raw audio stream as m4a
                final_filename = f"ClipFetch_{safe_title}.m4a"
                final_output_path = os.path.join(ticket_dir, final_filename)
                os.rename(temp_audio_file, final_output_path)
                mimetype = "audio/mp4"

        else:
            # Video download (progressive or adaptive merged)
            chosen_stream = None

            # Attempt to extract itag from format_id (e.g. yt-137-1080p -> 137)
            itag_match = re.search(r"yt-(\d+)", format_id)
            if itag_match:
                itag_val = int(itag_match.group(1))
                chosen_stream = streams.get_by_itag(itag_val)

            # If not matched by itag, search by resolution or default to best progressive
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

            final_filename = f"ClipFetch_{safe_title}.mp4"
            final_output_path = os.path.join(ticket_dir, final_filename)

            if chosen_stream.is_progressive:
                # Progressive: Already includes video + audio
                chosen_stream.download(output_path=ticket_dir, filename=final_filename)
            else:
                # Adaptive (e.g. 1080p video only): download video + audio and merge with ffmpeg
                video_temp = os.path.join(ticket_dir, "video_stream.mp4")
                chosen_stream.download(output_path=ticket_dir, filename="video_stream.mp4")

                best_audio = streams.filter(only_audio=True).order_by('abr').desc().first()
                ffmpeg_path = shutil.which("ffmpeg")

                if best_audio and ffmpeg_path:
                    audio_temp = os.path.join(ticket_dir, "audio_stream.m4a")
                    best_audio.download(output_path=ticket_dir, filename="audio_stream.m4a")

                    # Merge with ffmpeg
                    merge_cmd = [
                        ffmpeg_path, "-y",
                        "-i", video_temp,
                        "-i", audio_temp,
                        "-c:v", "copy",
                        "-c:a", "aac",
                        "-movflags", "+faststart",
                        final_output_path
                    ]
                    subprocess.run(merge_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
                else:
                    # If ffmpeg is absent, rename video stream
                    os.rename(video_temp, final_output_path)

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
                "filename": final_filename,
                "mimetype": mimetype,
                "created_at": time.time()
            }

        download_relative_url = f"/api/download-file/{ticket_id}"

        response_data = {
            "success": True,
            "download_id": ticket_id,
            "downloadUrl": download_relative_url,
            "filename": final_filename,
            "data": {
                "download_id": ticket_id,
                "downloadUrl": download_relative_url,
                "filename": final_filename
            }
        }

        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Download processing failed: {e}", exc_info=True)
        # Clean up directory on error
        shutil.rmtree(ticket_dir, ignore_errors=True)
        return jsonify({
            "success": False,
            "error": {
                "code": "DOWNLOAD_ERROR",
                "message": f"Download failed: {str(e)}"
            }
        }), 502


@app.route("/api/download-file/<ticket_id>", methods=["GET"])
def stream_file(ticket_id: str):
    """Serve the generated file and schedule its cleanup."""
    with tickets_lock:
        ticket = tickets.get(ticket_id)

    if not ticket or not os.path.exists(ticket["file_path"]):
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "Download link expired or invalid."}
        }), 404

    file_path = ticket["file_path"]
    filename = ticket["filename"]
    mimetype = ticket.get("mimetype", "application/octet-stream")

    # Schedule deferred cleanup after download finishes
    delayed_cleanup(os.path.dirname(file_path), ticket_id, delay=60)

    return send_file(
        file_path,
        as_attachment=True,
        download_name=filename,
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
