"""
ClipFatch - Flask + yt-dlp Video & Audio Downloader API
High-performance media extraction microservice with Gunicorn support.
"""

import os
import re
import shutil
import tempfile
import time
from urllib.parse import urlparse
from typing import Dict, Any, Optional, List

from flask import Flask, request, jsonify, send_file, after_this_request
import yt_dlp

app = Flask(__name__)

# Basic CORS headers for all responses
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept"
    return response

# Configuration
MAX_MB = int(os.getenv("MAX_MB", "250"))
SOCKET_TIMEOUT = int(os.getenv("SOCKET_TIMEOUT", "25"))
COOKIES = os.getenv("IG_COOKIES_FILE") or os.getenv("YTDL_COOKIES_FILE") or os.getenv("COOKIES_FILE")
PROXY = os.getenv("PROXY_URL") or os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY")
HAS_FFMPEG = shutil.which("ffmpeg") is not None

# Sliding window rate limiter
RATE_LIMIT = int(os.getenv("RATE_LIMIT", "30"))  # requests per minute
_hits: Dict[str, List[float]] = {}

def check_rate_limit(ip: str) -> bool:
    now = time.time()
    times = [t for t in _hits.get(ip, []) if now - t < 60.0]
    if len(times) >= RATE_LIMIT:
        return False
    times.append(now)
    _hits[ip] = times
    return True

def normalize_url(raw: Any) -> str:
    url = str(raw or "").strip()
    if not url:
        raise ValueError("URL cannot be empty.")
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("Invalid URL format.")
    
    # Reject private/internal IP ranges (SSRF Guard)
    if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"):
        raise ValueError("Internal and local addresses are not permitted.")
    if hostname.startswith("10.") or hostname.startswith("192.168.") or hostname.startswith("172."):
        raise ValueError("Private network addresses are not permitted.")
        
    return url

def get_base_ydl_opts() -> dict:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": SOCKET_TIMEOUT,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }
    if COOKIES and os.path.exists(COOKIES):
        opts["cookiefile"] = COOKIES
    if PROXY:
        opts["proxy"] = PROXY
    if HAS_FFMPEG:
        opts["ffmpeg_location"] = shutil.which("ffmpeg")
    return opts

def format_error(err: Exception) -> tuple[dict, int]:
    msg = str(err).lower()
    if any(k in msg for k in ["login", "private", "cookies", "rate-limit", "restricted"]):
        return {
            "success": False,
            "detail": "This video is private or the platform requires a login. Only public videos can be saved.",
            "error": {"code": "RESTRICTED", "message": "This video is private or requires authentication."}
        }, 422
    if any(k in msg for k in ["unsupported url", "no video", "not found"]):
        return {
            "success": False,
            "detail": "No video was found at that link.",
            "error": {"code": "NOT_FOUND", "message": "No video was found at that link."}
        }, 422
    if any(k in msg for k in ["max-filesize", "larger than"]):
        return {
            "success": False,
            "detail": f"That video exceeds the maximum allowed file size ({MAX_MB} MB).",
            "error": {"code": "OVERSIZED", "message": f"Video exceeds {MAX_MB} MB limit."}
        }, 413
    return {
        "success": False,
        "detail": "Could not fetch media from that link. Try again in a moment.",
        "error": {"code": "FETCH_FAILED", "message": "Could not fetch media from that link. Please try again."}
    }, 502

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "ClipFatch API",
        "status": "online",
        "version": "1.0.0",
        "endpoints": [
            "GET  /api/health",
            "POST /api/analyze",
            "GET  /api/info?url=...",
            "GET  /api/download?url=...&type=video|audio&quality=best|1080|720|480|360"
        ]
    })

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "success": True,
        "data": {
            "status": "operational",
            "service": "ClipFatch API",
            "dependencies": {
                "ffmpeg": HAS_FFMPEG,
                "yt_dlp": yt_dlp.version.__version__,
            },
            "limits": {
                "max_mb": MAX_MB,
                "rate_limit_per_min": RATE_LIMIT
            }
        }
    })

def extract_media_data(url: str) -> dict:
    opts = get_base_ydl_opts()
    opts["dump_single_json"] = True
    opts["extract_flat"] = False

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("No video information could be retrieved.")
        if info.get("_type") == "playlist":
            entries = info.get("entries") or []
            info = next((e for e in entries if e), info)

    title = info.get("title") or info.get("description") or "Video"
    if len(title) > 140:
        title = title[:137] + "..."

    duration = info.get("duration")
    duration_fmt = None
    if duration:
        m, s = divmod(int(duration), 60)
        duration_fmt = f"{m}:{s:02d}"

    # Extract available video resolutions
    available_formats = []
    formats_raw = info.get("formats") or []
    seen_heights = set()

    for f in formats_raw:
        h = f.get("height")
        if h and h >= 144 and h not in seen_heights:
            seen_heights.add(h)
            quality_label = f"{h}p (Full HD)" if h >= 1080 else f"{h}p (HD)" if h >= 720 else f"{h}p"
            available_formats.append({
                "id": f"{h}p",
                "format": "MP4",
                "quality": quality_label,
                "resolution": f"{f.get('width') or round(h * 16 / 9)}x{h}",
                "height": h,
                "isHd": h >= 720,
                "hasAudio": True,
                "hasVideo": True,
                "mediaType": "video",
                "url": f"/api/download?url={url}&type=video&quality={h}"
            })

    available_formats.sort(key=lambda x: x.get("height", 0), reverse=True)
    if not available_formats:
        available_formats.append({
            "id": "best",
            "format": "MP4",
            "quality": "Best Quality (MP4)",
            "height": 720,
            "isHd": True,
            "hasAudio": True,
            "hasVideo": True,
            "mediaType": "video",
            "url": f"/api/download?url={url}&type=video&quality=best"
        })

    # Standard MP3 Audio options
    audio_formats = [
        {"id": "audio-mp3-48k", "format": "MP3", "quality": "48 kbps (Voice)", "audioBitrate": 48, "isAudio": True, "mediaType": "audio", "url": f"/api/download?url={url}&type=audio&quality=48"},
        {"id": "audio-mp3-128k", "format": "MP3", "quality": "128 kbps (Standard)", "audioBitrate": 128, "isAudio": True, "mediaType": "audio", "url": f"/api/download?url={url}&type=audio&quality=128"},
        {"id": "audio-mp3-320k", "format": "MP3", "quality": "320 kbps (High Quality)", "audioBitrate": 320, "isAudio": True, "mediaType": "audio", "url": f"/api/download?url={url}&type=audio&quality=320"},
    ]

    all_formats = available_formats + audio_formats

    return {
        "id": info.get("id") or "media",
        "url": url,
        "originalUrl": url,
        "title": title,
        "uploader": info.get("uploader") or info.get("channel") or None,
        "author": info.get("uploader") or info.get("channel") or None,
        "thumbnail": info.get("thumbnail") or None,
        "duration": duration,
        "durationFormatted": duration_fmt,
        "formats": all_formats,
        "audio_options": audio_formats,
        "downloadAvailable": True
    }

@app.route("/api/info", methods=["GET", "POST"])
def get_info():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "client")
    if not check_rate_limit(client_ip):
        return jsonify({"detail": "Too many requests. Please wait a minute and try again."}), 429

    raw_url = request.args.get("url") or (request.get_json(silent=True) or {}).get("url")
    if not raw_url:
        return jsonify({"detail": "Please provide a valid video URL."}), 400

    try:
        url = normalize_url(raw_url)
        data = extract_media_data(url)
        return jsonify(data)
    except Exception as e:
        payload, code = format_error(e)
        return jsonify(payload), code

@app.route("/api/analyze", methods=["POST"])
def analyze_video():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "client")
    if not check_rate_limit(client_ip):
        return jsonify({"success": False, "error": {"code": "RATE_LIMITED", "message": "Too many requests."}}), 429

    payload = request.get_json(silent=True) or {}
    raw_url = payload.get("url")
    if not raw_url:
        return jsonify({"success": False, "error": {"code": "MISSING_URL", "message": "Please enter a valid URL."}}), 400

    try:
        url = normalize_url(raw_url)
        data = extract_media_data(url)
        return jsonify({
            "success": True,
            "data": data,
            "platform": "facebook" if "facebook" in url or "fb.watch" in url else "general",
            "platformLabel": "Facebook" if "facebook" in url or "fb.watch" in url else "Social Media",
            "formats": data["formats"],
            "title": data["title"],
            "author": data["author"],
            "thumbnail": data["thumbnail"],
            "duration": data["duration"],
            "durationFormatted": data["durationFormatted"]
        })
    except Exception as e:
        err_res, code = format_error(e)
        return jsonify(err_res), code

@app.route("/api/check", methods=["GET", "HEAD"])
def check_api():
    res = jsonify({"status": "ok", "time": int(time.time())})
    res.headers["X-Content-Type-Options"] = "nosniff"
    res.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    return res, 200

@app.route("/api/download", methods=["GET", "HEAD"])
def download_media():
    if request.method == "HEAD":
        media_type = request.args.get("type", "video").lower()
        mimetype = "audio/mpeg" if media_type == "audio" else "video/mp4"
        response = app.response_class("", mimetype=mimetype)
        response.headers["Content-Disposition"] = 'attachment; filename="ClipFetch_media.mp4"'
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        return response, 200

    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "client")
    if not check_rate_limit(client_ip):
        return jsonify({"detail": "Too many requests. Please wait a minute and try again."}), 429

    raw_url = request.args.get("url")
    if not raw_url:
        return jsonify({"detail": "Missing URL parameter."}), 400

    media_type = request.args.get("type", "video").lower()
    quality = request.args.get("quality", "best").lower()

    try:
        url = normalize_url(raw_url)
    except Exception:
        return jsonify({"detail": "Invalid or restricted URL provided."}), 400

    temp_dir = tempfile.mkdtemp(prefix="clipfatch_")

    try:
        opts = get_base_ydl_opts()
        opts["max_filesize"] = f"{MAX_MB}M"
        out_template = os.path.join(temp_dir, "%(title).60s_%(id)s.%(ext)s")
        opts["outtmpl"] = out_template

        if media_type == "audio":
            bitrate = "320" if quality == "320" else "48" if quality == "48" else "128"
            opts["format"] = "bestaudio/best"
            if HAS_FFMPEG:
                opts["postprocessors"] = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": bitrate,
                }]
        else:
            if quality.isdigit():
                height = int(quality)
                opts["format"] = f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/b"
            else:
                opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/b[ext=mp4]/best"
            
            if HAS_FFMPEG:
                opts["merge_output_format"] = "mp4"

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        files = [os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if os.path.isfile(os.path.join(temp_dir, f))]
        if not files:
            raise RuntimeError("Download completed but no output file was created.")

        target_file = files[0]
        filename = os.path.basename(target_file)
        # Clean up illegal chars in filename for Content-Disposition
        clean_name = re.sub(r'[\r\n",]', "", filename)

        # Requirement 3: Backend safety check: confirm output is > 100 KB and has valid signature
        file_size = os.path.getsize(target_file)
        if file_size < 100 * 1024:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify({
                "success": False,
                "detail": f"Generated file is under 100 KB ({file_size // 1024} KB). Download incomplete or blocked.",
                "error": {"code": "FILE_TOO_SMALL", "message": "File is smaller than 100 KB"}
            }), 502

        if media_type != "audio":
            with open(target_file, "rb") as f:
                header = f.read(16)
            if len(header) < 8 or header[4:8] != b"ftyp":
                shutil.rmtree(temp_dir, ignore_errors=True)
                return jsonify({
                    "success": False,
                    "detail": "Generated file does not have a valid MP4 signature (missing 'ftyp'). Received HTML or corrupt data.",
                    "error": {"code": "INVALID_SIGNATURE", "message": "Missing ftyp MP4 box signature"}
                }), 502

        @after_this_request
        def cleanup(response):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
            return response

        mimetype = "audio/mpeg" if media_type == "audio" else "video/mp4"
        response = send_file(target_file, as_attachment=True, download_name=clean_name, mimetype=mimetype)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        return response

    except Exception as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        payload, code = format_error(e)
        return jsonify(payload), code

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
