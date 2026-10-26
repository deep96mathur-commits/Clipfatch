FROM python:3.10-slim

# Install system dependencies including FFmpeg for 1080p merging and MP3 conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

ENV PORT=5000
ENV PYTHONUNBUFFERED=1
ENV TEMP_DIR=/tmp/clipfetch_flask

EXPOSE 5000

CMD exec gunicorn -w 2 -b 0.0.0.0:$PORT --timeout 120 app:app
