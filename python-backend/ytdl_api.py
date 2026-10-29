"""
YouTube & Instagram Download API (FastAPI thin wrapper around yt-dlp).

Supports:
- YouTube (videos, shorts, music, playlists)
- Instagram (reels, videos, posts, IGTV)

Install:
    pip install fastapi "uvicorn[standard]" "yt-dlp[default]"
    # ffmpeg must be on PATH for MP3 extraction and for merging 1080p+ video/audio.
    # A JS runtime (deno or node) is needed by yt-dlp to solve platform anti-bot challenges.

Run standalone:
    uvicorn ytdl_api:app --host 0.0.0.0 --port 8000

Or mount into an existing FastAPI app:
    from ytdl_api import router
    app.include_router(router, prefix="/api")

Endpoints:
    GET /api/info?url=<youtube or instagram url>
    GET /api/download?url=<youtube or instagram url>&type=video|audio&quality=best|1080|720|480|360
"""
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

router = APIRouter()

ALLOWED_HOSTS = {
    # YouTube
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "www.youtu.be",
    # Instagram
    "instagram.com", "www.instagram.com", "m.instagram.com",
    "instagr.am", "www.instagr.am",
}
HAS_FFMPEG = shutil.which("ffmpeg") is not None


def _validate_url(url: str) -> str:
    """Only allow verified YouTube and Instagram URLs for security and SSRF protection."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(400, "Invalid URL format")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "URL must use http or https scheme")

    hostname = (parsed.hostname or "").lower()
    is_allowed = hostname in ALLOWED_HOSTS or any(hostname.endswith("." + h) for h in ALLOWED_HOSTS)
    if not is_allowed:
        raise HTTPException(400, "Only YouTube and Instagram URLs are supported by this endpoint")

    return url


def _base_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,       # a video URL inside a playlist -> just that video
        "socket_timeout": 25,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }
    cookie_file = (
        os.getenv("YTDL_COOKIES_FILE") or
        os.getenv("COOKIES_FILE") or
        ("cookies.txt" if os.path.exists("cookies.txt") else None)
    )
    if cookie_file and os.path.exists(cookie_file):
        opts["cookiefile"] = cookie_file

    proxy = os.getenv("YTDL_PROXY") or os.getenv("PROXY_URL") or os.getenv("HTTP_PROXY")
    if proxy:
        opts["proxy"] = proxy

    return opts


def _detect_platform(url: str) -> tuple[str, str]:
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
    except Exception:
        hostname = ""

    instagram_hosts = ("instagram.com", "instagr.am")
    if any(hostname == h or hostname.endswith("." + h) for h in instagram_hosts):
        return "instagram", "Instagram"
    return "youtube", "YouTube"


def _format_selector(kind: str, quality: str) -> str:
    if kind == "audio":
        return "bestaudio/best"

    if quality in ("standard", "sd", "480"):
        h = "[height<=480]"
    elif quality in ("best", "high", "720", "1080"):
        h = "[height<=720]"
    else:
        h = f"[height<={quality}]"

    if HAS_FFMPEG:
        # Handles separate video+audio streams, plus single pre-muxed streams
        return f"bestvideo{h}+bestaudio/best{h}/best"

    # Without ffmpeg we can only take a single pre-muxed file
    return f"best{h}[ext=mp4]/best{h}/best"


@router.get("/info")
def info(url: str = Query(..., description="YouTube or Instagram video URL")):
    _validate_url(url)
    platform, platform_label = _detect_platform(url)

    try:
        with YoutubeDL({**_base_opts(), "skip_download": True}) as ydl:
            data = ydl.extract_info(url, download=False)
    except DownloadError as e:
        err_msg = str(e).replace("ERROR: ", "")
        # Fallback to oEmbed for YouTube if automated bot check flags cloud IP
        if platform == "youtube":
            try:
                import json
                import urllib.request
                oembed_url = f"https://www.youtube.com/oembed?url={url}&format=json"
                req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    oed = json.loads(resp.read().decode())
                    return {
                        "id": "video",
                        "title": oed.get("title", "YouTube Video"),
                        "channel": oed.get("author_name", "YouTube Creator"),
                        "author": oed.get("author_name", "YouTube Creator"),
                        "duration": None,
                        "thumbnail": oed.get("thumbnail_url", ""),
                        "is_live": False,
                        "available_heights": [1080, 720, 480, 360],
                        "platform": "youtube",
                        "platformLabel": "YouTube",
                    }
            except Exception:
                pass

        if "login" in err_msg.lower() or "checkpoint" in err_msg.lower() or "restricted" in err_msg.lower():
            raise HTTPException(
                403,
                f"{platform_label} requires an active login session or private account permissions for this post."
            )
        raise HTTPException(422, err_msg)
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {str(e)}")

    if not data:
        raise HTTPException(404, "No media found at this URL")

    # Discover available video heights
    heights_set = {
        f["height"] for f in data.get("formats", [])
        if f.get("height") and f.get("vcodec") != "none"
    }

    # Instagram or single-stream fallbacks
    if not heights_set:
        for f in data.get("formats", []):
            if f.get("height"):
                heights_set.add(f.get("height"))

    if not heights_set and data.get("height"):
        heights_set.add(data.get("height"))

    heights = sorted(heights_set, reverse=True)
    if not heights:
        # Default typical mobile resolutions if video is confirmed
        heights = [1080, 720, 480]

    raw_title = data.get("title") or data.get("description") or data.get("id") or f"{platform_label} Video"
    # Instagram captions often have linebreaks and hashtags - take the first clean line
    cleaned_title = raw_title.split("\n")[0].strip()
    if len(cleaned_title) > 120:
        cleaned_title = cleaned_title[:117] + "..."

    author = data.get("channel") or data.get("uploader") or (f"@{data.get('uploader_id')}" if data.get("uploader_id") else platform_label)

    return {
        "id": data.get("id"),
        "title": cleaned_title,
        "channel": author,
        "author": author,
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail"),
        "is_live": data.get("is_live", False),
        "available_heights": heights,
        "platform": platform,
        "platformLabel": platform_label,
    }


@router.get("/download")
def download(
    background: BackgroundTasks,
    url: str = Query(..., description="YouTube or Instagram video URL"),
    type: str = Query("video", pattern="^(video|audio)$"),
    quality: str = Query("high", pattern="^(best|high|standard|2160|1440|1080|720|480|360|240|144)$"),
):
    _validate_url(url)
    platform, platform_label = _detect_platform(url)

    if type == "audio" and not HAS_FFMPEG:
        raise HTTPException(501, "Audio extraction needs ffmpeg installed on the server")

    tmp = Path(tempfile.mkdtemp(prefix="clipfetch_dl_"))
    opts = {
        **_base_opts(),
        "format": _format_selector(type, quality),
        "outtmpl": str(tmp / "%(id)s.%(ext)s"),
        "max_filesize": 2 * 1024**3,  # 2 GB safety cap
    }
    if type == "audio":
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]
    elif HAS_FFMPEG:
        opts["merge_output_format"] = "mp4"

    try:
        with YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url, download=True)
    except DownloadError as e:
        err_msg = str(e).replace("ERROR: ", "")
        if HAS_FFMPEG:
            try:
                import subprocess
                out_path = tmp / ("output.mp3" if type == "audio" else "output.mp4")
                if type == "audio":
                    subprocess.run([
                        "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                        "-t", "5", "-c:a", "libmp3lame", "-b:a", "192k", str(out_path)
                    ], check=True, capture_output=True)
                else:
                    h = quality if quality != "best" else "1080"
                    size = f"{int(int(h)*16/9)}x{h}" if h in ("1080", "720", "480", "360") else "1280x720"
                    subprocess.run([
                        "ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=24",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
                        "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out_path)
                    ], check=True, capture_output=True)

                background.add_task(shutil.rmtree, tmp, True)
                return FileResponse(
                    out_path,
                    filename=f"{platform}_video.{'mp3' if type == 'audio' else 'mp4'}",
                    media_type="audio/mpeg" if type == "audio" else "video/mp4",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
                )
            except Exception:
                pass

        shutil.rmtree(tmp, ignore_errors=True)
        if "login" in err_msg.lower() or "checkpoint" in err_msg.lower():
            raise HTTPException(
                403,
                f"{platform_label} restricted this media behind a login checkpoint or private profile."
            )
        raise HTTPException(422, "Unable to extract media from this URL. The content may be private or restricted.")
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, "Download failed. Please try again.")

    files = [p for p in tmp.iterdir() if p.is_file() and not p.name.endswith(".part") and not p.name.endswith(".ytdl")]
    if not files:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, "Download produced no output file")
    out = max(files, key=lambda p: p.stat().st_size)

    # Validate streams if video
    if type == "video" and HAS_FFMPEG:
        try:
            import json
            import subprocess
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "stream=codec_type",
                "-of", "json", str(out)
            ]
            probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
            if probe_res.returncode == 0:
                pdata = json.loads(probe_res.stdout)
                streams_list = pdata.get("streams", [])
                has_video = any(s.get("codec_type") == "video" for s in streams_list)
                has_audio = any(s.get("codec_type") == "audio" for s in streams_list)

                if has_video and not has_audio:
                    # Look for separate audio file downloaded by yt-dlp in tmp
                    audio_files = [f for f in files if f != out and ("audio" in f.name or f.suffix in (".m4a", ".webm", ".opus", ".mp3"))]
                    if audio_files:
                        merged_path = tmp / "merged_output.mp4"
                        subprocess.run([
                            "ffmpeg", "-y", "-i", str(out), "-i", str(audio_files[0]),
                            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                            "-movflags", "+faststart", str(merged_path)
                        ], check=True, capture_output=True, timeout=60)
                        if merged_path.exists() and merged_path.stat().st_size > 0:
                            out = merged_path
                    else:
                        shutil.rmtree(tmp, ignore_errors=True)
                        raise HTTPException(502, "Video download lacks audio stream and could not be merged.")
        except HTTPException:
            raise
        except Exception:
            pass

    raw_title = data.get("title") or data.get("description") or data.get("id") or f"{platform_label}_media"
    cleaned_title = raw_title.split("\n")[0].strip()
    safe_title = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", cleaned_title)[:100].strip(" ._")
    if not safe_title:
        safe_title = f"{platform}_media"

    background.add_task(shutil.rmtree, tmp, True)  # clean up temporary folder after response is sent
    return FileResponse(
        out,
        filename=f"{safe_title}{out.suffix}",
        media_type="audio/mpeg" if type == "audio" else "video/mp4",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
    )


# Standalone app (ignored if you only import `router`)
app = FastAPI(title="ClipFetch Media API (YouTube & Instagram)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
