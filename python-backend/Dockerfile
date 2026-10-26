FROM python:3.11-slim

# Install system dependencies: ffmpeg, ffprobe, ca-certificates, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Environment variables
ENV PORT=8000
ENV MAX_DOWNLOAD_SIZE_MB=150
ENV DOWNLOAD_TIMEOUT_SECONDS=60
ENV TEMP_DIR=/tmp/clipfetch

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
