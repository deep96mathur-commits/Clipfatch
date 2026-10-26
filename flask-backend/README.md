# ClipFetch Flask pytubefix API

This is the standalone Python Flask backend for ClipFetch, powered by **pytubefix** and **FFmpeg**. It provides media extraction, format discovery, 1080p Full HD video merging, and 48/128/320 kbps MP3 audio conversion for YouTube videos.

---

## Features

- **pytubefix Media Extraction**: Retrieves real video metadata (title, author, duration, thumbnail, available resolutions).
- **Format Discovery & Deduplication**: Discovers progressive MP4 streams and adaptive 1080p Full HD streams.
- **Audio Extraction**: Converts audio into 48 kbps, 128 kbps, or 320 kbps MP3 files via FFmpeg.
- **Adaptive Stream Merging**: Merges high-resolution video streams (1080p) with high-bitrate audio streams using FFmpeg.
- **SSRF & Security Guards**: Rejects internal/private IP ranges, localhost, and non-YouTube hosts.
- **CORS Support**: Configurable via `CORS_ORIGIN` for seamless browser requests from your published frontend.

---

## API Endpoints

### 1. `GET /api/health`
Checks backend health and dependency status (pytubefix, ffmpeg, ffprobe).

**Example Response:**
```json
{
  "success": true,
  "data": {
    "status": "operational",
    "version": "1.0.0",
    "service": "ClipFetch Flask pytubefix API",
    "supportedPlatforms": ["youtube"],
    "dependencies": {
      "pytubefix": true,
      "ffmpeg": true,
      "ffprobe": true
    }
  }
}
```

### 2. `POST /api/analyze` (or `POST /api/video-info`)
Extracts YouTube metadata and available download resolutions.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response:**
```json
{
  "success": true,
  "platform": "youtube",
  "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
  "author": "Rick Astley",
  "duration": 212,
  "durationFormatted": "3:32",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  "formats": [
    {
      "id": "yt-18-360p",
      "resolution": "640x360",
      "quality": "360p",
      "format": "MP4",
      "hasAudio": true
    },
    {
      "id": "yt-22-720p",
      "resolution": "1280x720",
      "quality": "720p (HD)",
      "format": "MP4",
      "hasAudio": true
    },
    {
      "id": "yt-137-1080p",
      "resolution": "1920x1080",
      "quality": "1080p (Full HD)",
      "format": "MP4",
      "hasAudio": true
    }
  ],
  "audio_options": [
    { "id": "audio-mp3-48k", "format": "MP3", "audioBitrate": 48, "quality": "48 kbps" },
    { "id": "audio-mp3-128k", "format": "MP3", "audioBitrate": 128, "quality": "128 kbps" },
    { "id": "audio-mp3-320k", "format": "MP3", "audioBitrate": 320, "quality": "320 kbps" }
  ]
}
```

### 3. `POST /api/download`
Prepares a video or MP3 file for download.

**Request Body (Video):**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "mediaType": "video",
  "formatId": "yt-137-1080p",
  "title": "Never_Gonna_Give_You_Up"
}
```

**Request Body (Audio MP3):**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "mediaType": "audio",
  "audioBitrate": 128,
  "title": "Never_Gonna_Give_You_Up"
}
```

**Response:**
```json
{
  "success": true,
  "download_id": "8f3b23c5-...",
  "downloadUrl": "/api/download-file/8f3b23c5-...",
  "filename": "ClipFetch_Never_Gonna_Give_You_Up.mp4"
}
```

### 4. `GET /api/download-file/<download_id>`
Streams the generated MP4 or MP3 file to the browser as an attachment.

---

## Local Development Setup

1. **Prerequisites**: Python 3.10+ and FFmpeg installed on your machine (`brew install ffmpeg` on macOS, or `sudo apt install ffmpeg` on Ubuntu).
2. **Create a virtual environment**:
   ```bash
   cd flask-backend
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
4. **Run the API server**:
   ```bash
   python app.py
   ```
   The API will start at `http://localhost:5000`.

---

## Cloud Deployment Guide

### Option 1: Render (Recommended - Free / Easy)
1. Push your repository to GitHub or GitLab.
2. Log in to [Render](https://render.com) and click **New +** → **Web Service**.
3. Select your repository and configure:
   - **Root Directory**: `flask-backend`
   - **Environment**: `Python 3` (or `Docker` if you want FFmpeg auto-installed)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -w 2 -b 0.0.0.0:$PORT --timeout 120 app:app`
4. Set Environment Variables:
   - `CORS_ORIGIN`: Your published frontend URL (e.g., `https://your-frontend.com`)
   - `TEMP_DIR`: `/tmp/clipfetch_flask`
5. Click **Create Web Service**. Once deployed, copy your service URL (e.g. `https://clipfetch-api.onrender.com`).

### Option 2: Railway
1. Go to [Railway](https://railway.app) and select **New Project** → **Deploy from GitHub repo**.
2. Select the repository and set the root directory to `flask-backend` (or use Dockerfile).
3. Railway automatically builds the included `Dockerfile` with FFmpeg installed.
4. Add environment variable `CORS_ORIGIN=*` or your frontend URL.
5. Generate a public domain and copy the HTTPS URL.

### Option 3: Fly.io
1. In `flask-backend`, run:
   ```bash
   fly launch
   ```
2. Fly.io will build using the `Dockerfile`.
3. Run `fly deploy`.

### Option 4: Docker (Self-Hosted / VPS)
```bash
docker build -t clipfetch-flask .
docker run -p 5000:5000 -e CORS_ORIGIN="*" clipfetch-flask
```

---

## Connecting Your Published Frontend

Once your Flask backend is running on a public HTTPS URL:

1. In your frontend hosting platform (e.g. Vercel, Netlify, Cloudflare Pages, Firebase Hosting):
2. Add the environment variable:
   ```
   VITE_API_BASE_URL=https://your-flask-api.onrender.com
   ```
3. Re-deploy the frontend build (`npm run build`).
4. Verify by opening your website and submitting a YouTube link!
