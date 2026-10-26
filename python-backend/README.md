# ClipFetch - Python FastAPI yt-dlp Backend

High-performance YouTube & Instagram video and audio extraction service powered by **FastAPI**, **yt-dlp**, and **FFmpeg**.

## Installation

```bash
cd python-backend
pip install -r requirements.txt
```

> **Requirements:** `ffmpeg` must be installed on your system PATH to enable 1080p+ Full HD audio/video merging and MP3 conversion.

## Running Standalone (`ytdl_api.py`)

Run the thin yt-dlp wrapper API directly on port 8000:

```bash
uvicorn ytdl_api:app --host 0.0.0.0 --port 8000
```

### Endpoints (YouTube & Instagram)
- `GET /api/info?url=<youtube_or_instagram_url>`: Extracts metadata, title, duration, thumbnail, and available resolutions (`available_heights`) for YouTube videos, shorts, Instagram reels, videos, and posts.
- `GET /api/download?url=<youtube_or_instagram_url>&type=video|audio&quality=best|1080|720|480|360`: Directly downloads and streams the merged MP4 or MP3 file to the browser with sanitized filename and automatic background cleanup.

## Running the Full ClipFetch Python API (`main.py`)

The full backend provides support for YouTube, Instagram, Facebook, and X (Twitter) with both `POST` and `GET` APIs:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

- `POST /api/analyze`: Comprehensive multi-platform metadata analysis with separate video format and MP3 audio bitrates (48, 128, 320 kbps).
- `POST /api/download`: Generates one-time download tickets with FFmpeg merging and direct file streaming.
- `GET /api/info`: Mounts `ytdl_api` info endpoint.
- `GET /api/download`: Mounts `ytdl_api` direct streaming endpoint.
- `GET /api/health`: Health status and dependency check (FFmpeg, FFprobe, yt-dlp).

## Connecting to ClipFetch Frontend

Set `VITE_API_BASE_URL` in your frontend `.env` (or hosting platform environment variables) to point to your FastAPI server:

```env
VITE_API_BASE_URL=https://your-api-domain.com
```

The ClipFetch frontend automatically supports both `POST /api/analyze` + `POST /api/download` and the direct `GET /api/info` + `GET /api/download` routes.
