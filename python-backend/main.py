import os
import shutil
import uuid
import time
import subprocess
from urllib.parse import urlparse
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import yt_dlp

app = FastAPI(
    title="ClipFetch Media API",
    version="1.2.0",
    description="Production-grade video extraction and conversion API"
)

# CORS configuration
ALLOWED_ORIGINS = os.getenv("CORS_ORIGIN", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount YouTube yt-dlp API router (GET /api/info, GET /api/download)
try:
    from ytdl_api import router as ytdl_router
    app.include_router(ytdl_router, prefix="/api")
except Exception as e:
    print(f"Warning: Could not mount ytdl_router: {e}")

TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/clipfetch")
os.makedirs(TEMP_DIR, exist_ok=True)

# Allowed platform domains for SSRF protection
ALLOWED_DOMAINS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
    "facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch",
    "instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am",
    "x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "t.co"
}

def validate_platform_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("URL must start with http or https")
        hostname = (parsed.hostname or "").lower()
        if hostname not in ALLOWED_DOMAINS:
            # Check domain suffix
            matches = any(hostname == d or hostname.endswith("." + d) for d in ALLOWED_DOMAINS)
            if not matches:
                raise ValueError(f"Domain {hostname} is not supported or failed security check")
        return hostname
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# In-memory download tickets
tickets: Dict[str, Dict[str, Any]] = {}

def cleanup_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass

class AnalyzeRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    type: Optional[str] = "video"
    mediaType: Optional[str] = None
    format_id: Optional[str] = None
    formatId: Optional[str] = None
    resolution: Optional[str] = None
    container: Optional[str] = "mp4"
    audioBitrate: Optional[int] = 128
    bitrate: Optional[int] = None
    title: Optional[str] = None

@app.get("/api/health")
def health():
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    ffprobe_ok = shutil.which("ffprobe") is not None
    ytdlp_ok = shutil.which("yt-dlp") is not None

    return {
        "success": True,
        "data": {
            "status": "operational",
            "version": "1.2.0",
            "service": "ClipFetch Python API",
            "supportedPlatforms": ["youtube", "facebook", "instagram", "x"],
            "dependencies": {
                "ffmpeg": ffmpeg_ok,
                "ffprobe": ffprobe_ok,
                "ytdlp": ytdlp_ok,
            },
            "features": ["video_download", "mp3_audio_extraction", "ffmpeg_muxing", "ssrf_guard"],
        }
    }

@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    validate_platform_url(req.url)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "socket_timeout": 25,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
    except Exception as e:
        err_str = str(e)
        if "login" in err_str.lower() or "checkpoint" in err_str.lower() or "restricted" in err_str.lower():
            raise HTTPException(
                status_code=403,
                detail="This post requires an active login session or private account permissions."
            )
        raise HTTPException(status_code=422, detail=f"Failed to extract media information: {err_str}")

    formats_out = []
    seen_heights = set()
    raw_formats = info.get("formats", [])

    for f in raw_formats:
        h = f.get("height")
        if not h or h < 144:
            continue
        if h in seen_heights:
            continue
        seen_heights.add(h)

        quality_label = f"{h}p (Full HD)" if h == 1080 else f"{h}p (HD)" if h == 720 else f"{h}p (SD)" if h == 480 else f"{h}p"
        formats_out.append({
            "id": f.get("format_id", str(h)),
            "resolution": f.get("resolution") or f"{h}p",
            "quality": quality_label,
            "ext": "mp4",
            "height": h,
            "has_audio": f.get("acodec") not in (None, "none"),
            "has_video": f.get("vcodec") not in (None, "none"),
            "filesize": f.get("filesize") or f.get("filesize_approx"),
        })

    # For Instagram reels/posts where formats lack explicit height metadata
    if not formats_out and (raw_formats or info.get("url")):
        default_h = info.get("height") or 720
        formats_out.append({
            "id": "best",
            "resolution": f"{default_h}p",
            "quality": f"{default_h}p (HD)" if default_h >= 720 else f"{default_h}p",
            "ext": "mp4",
            "height": default_h,
            "has_audio": True,
            "has_video": True,
            "filesize": info.get("filesize") or info.get("filesize_approx"),
        })

    # Sort formats ascending
    formats_out.sort(key=lambda x: x["height"])

    audio_options = [
        {"id": "audio-mp3-48k", "format": "mp3", "bitrate": 48, "label": "48 kbps (Voice / Low)"},
        {"id": "audio-mp3-128k", "format": "mp3", "bitrate": 128, "label": "128 kbps (Standard)"},
        {"id": "audio-mp3-320k", "format": "mp3", "bitrate": 320, "label": "320 kbps (High)"},
    ]

    raw_title = info.get("title") or info.get("description") or "Video"
    title = raw_title.split("\n")[0].strip() or "Video"
    if len(title) > 190:
        title = title[:187] + "..."

    return {
        "success": True,
        "platform": info.get("extractor_key", "generic").lower(),
        "platformLabel": info.get("extractor_key", "Social Media"),
        "title": title,
        "author": info.get("uploader") or info.get("channel"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "formats": formats_out,
        "audio_options": audio_options,
        "downloadAvailable": len(formats_out) > 0,
    }

@app.post("/api/download")
def download(req: DownloadRequest):
    validate_platform_url(req.url)

    req_type = req.mediaType or req.type or "video"
    is_audio = req_type == "audio"
    bitrate = req.audioBitrate or req.bitrate or 128
    if bitrate not in (48, 128, 320):
        bitrate = 128

    ticket_id = str(uuid.uuid4())
    safe_title = (req.title or "media").replace(" ", "_").split("\n")[0][:50].strip(" ._") or "media"

    common_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
    }

    if is_audio:
        filename = f"ClipFetch_{safe_title}_{bitrate}kbps.mp3"
        out_tmpl = os.path.join(TEMP_DIR, f"{ticket_id}_%(ext)s")
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": out_tmpl,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(bitrate),
            }],
            "quiet": True,
            "http_headers": common_headers,
        }
    else:
        fmt_id = req.formatId or req.format_id or "best"
        filename = f"ClipFetch_{safe_title}.mp4"
        out_tmpl = os.path.join(TEMP_DIR, f"{ticket_id}.%(ext)s")
        format_selector = (
            f"{fmt_id}+bestaudio/best/{fmt_id}/best"
            if fmt_id != "best"
            else "bestvideo+bestaudio/best"
        )
        ydl_opts = {
            "format": format_selector,
            "outtmpl": out_tmpl,
            "merge_output_format": "mp4",
            "quiet": True,
            "http_headers": common_headers,
        }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url])
    except Exception as e:
        err_str = str(e)
        if "login" in err_str.lower() or "checkpoint" in err_str.lower():
            raise HTTPException(
                status_code=403,
                detail="This media is restricted behind an Instagram login checkpoint or private profile."
            )
        raise HTTPException(status_code=502, detail=f"Download extraction failed: {err_str}")

    # Locate generated output file
    target_path = None
    expected_ext = "mp3" if is_audio else "mp4"
    for fname in os.listdir(TEMP_DIR):
        if fname.startswith(ticket_id) and fname.endswith(f".{expected_ext}"):
            target_path = os.path.join(TEMP_DIR, fname)
            break

    if not target_path or not os.path.exists(target_path):
        raise HTTPException(status_code=500, detail="Output file generation failed")

    tickets[ticket_id] = {
        "file_path": target_path,
        "filename": filename,
        "content_type": "audio/mpeg" if is_audio else "video/mp4",
        "created_at": time.time(),
    }

    download_url = f"/api/download-file/{ticket_id}"
    return {
        "success": True,
        "download_id": ticket_id,
        "downloadUrl": download_url,
        "filename": filename,
        "data": {
            "downloadUrl": download_url,
            "filename": filename,
            "download_id": ticket_id,
        }
    }

@app.get("/api/download-file/{download_id}")
def stream_file(download_id: str, background_tasks: BackgroundTasks):
    ticket = tickets.get(download_id)
    if not ticket or not os.path.exists(ticket["file_path"]):
        raise HTTPException(status_code=404, detail="Download ticket expired or invalid")

    file_path = ticket["file_path"]
    filename = ticket["filename"]
    content_type = ticket["content_type"]

    # Schedule cleanup after file response is served
    background_tasks.add_task(cleanup_file, file_path)
    tickets.pop(download_id, None)

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=content_type,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
    )
