# ClipFatch - Python Flask & yt-dlp Video Downloader Service

A microservice powered by **Flask 3**, **Gunicorn 22**, and **yt-dlp** for analyzing and downloading videos and audio streams from Facebook, Instagram, YouTube, and other public media sources.

---

## 🚀 Features

- **Media Metadata Extraction**: Fetches titles, channels, duration, thumbnails, and available format resolutions.
- **Multiple Video Qualities**: MP4 video streams up to 1080p Full HD, 720p HD, 480p, and 360p.
- **Direct MP3 Extraction**: Converts audio streams into 48 kbps, 128 kbps, and 320 kbps MP3 files via FFmpeg.
- **Ephemeral Storage**: All downloads are saved to isolated temporary directories and automatically wiped after transmission.
- **Production Ready**: Built for deployment on Docker, Render, Railway, Fly.io, Cloud Run, or VPS.

---

## 📦 Requirements

- Python 3.10+
- FFmpeg (installed and available on `PATH`)
- Packages listed in `requirements.txt`:
  ```txt
  flask>=3.0
  gunicorn>=22.0
  yt-dlp
  ```

---

## 🛠️ Quickstart

### 1. Local Development
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server
python app.py
```
The server will start on `http://localhost:8000`.

### 2. Run with Gunicorn (Production)
```bash
gunicorn --bind 0.0.0.0:8000 --workers 3 --threads 2 --timeout 120 app:app
```

### 3. Run with Docker
```bash
# Build Docker image
docker build -t clipfatch .

# Run container
docker run -p 8000:8000 --name clipfatch-service clipfatch
```

---

## 📡 API Endpoints

### 1. `GET /api/health`
Checks service health, FFmpeg availability, and yt-dlp version.

### 2. `POST /api/analyze`
Extracts structured video details. Compatible with the ClipFetch frontend.
```json
// POST /api/analyze
{
  "url": "https://www.facebook.com/watch/?v=10158792070386729"
}
```

### 3. `GET /api/info?url=<media_url>`
Returns JSON metadata, format resolutions, and audio options.

### 4. `GET /api/download?url=<media_url>&type=video|audio&quality=best|1080|720|480|360|320|128`
Streams the downloaded file as an attachment (`Content-Disposition: attachment`).
Temporary files are cleaned up immediately following response delivery.
