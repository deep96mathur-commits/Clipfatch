import { ApiResponse, VideoInfo, VideoFormat } from '../types/index.ts';

// Always use relative API endpoints ("/api/...") to guarantee same-domain first-party requests
export const API_BASE_URL = '';

// FIX 2: longer timeout to allow for server cold starts plus video extraction
const ANALYZE_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 3000;

export interface HealthStatus {
  isOnline: boolean;
  version?: string;
  uptimeSeconds?: number;
  service?: string;
  message?: string;
}

// FIX 1: read the body as text first, so an HTML error page (server starting up
// or crashing) gives a clear message instead of "Unexpected token <".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: {
        message: `Server returned an unexpected response (HTTP ${res.status}). It may be starting up, so please try again.`,
      },
    };
  }
}

export async function checkApiHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const json = (await safeJson(res)) as ApiResponse<{
        status: string;
        version: string;
        service?: string;
        uptimeSeconds?: number;
      }>;
      return {
        isOnline: true,
        version: json.data?.version,
        service: json.data?.service,
        uptimeSeconds: json.data?.uptimeSeconds,
      };
    }

    return {
      isOnline: false,
      message: `Backend responded with HTTP status ${res.status}`,
    };
  } catch {
    return {
      isOnline: false,
      message:
        'Unable to connect to the ClipFetch backend API. If hosting frontend and backend separately, verify VITE_API_BASE_URL is set in your environment.',
    };
  }
}

async function fetchVideoInfoOnce(url: string): Promise<VideoInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = (await safeJson(response)) as (ApiResponse<VideoInfo> & {
      data?: VideoInfo;
      audio_options?: Array<{
        id: string;
        format: string;
        quality?: string;
        audioBitrate?: number;
        bitrate?: number;
        filesizeFormatted?: string;
      }>;
    } & VideoInfo);

    if (response.status === 404 || response.status === 405) {
      // Graceful fallback to GET /api/info for standalone ytdl_api
      const infoRes = await fetch(`${API_BASE_URL}/api/info?url=${encodeURIComponent(url)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (infoRes.ok) {
        const rawInfo = await safeJson(infoRes);
        if (rawInfo && rawInfo.success !== false) {
          const sortedHeights = [480, 720];
          const mins = rawInfo.duration ? Math.floor(rawInfo.duration / 60) : 0;
          const secs = rawInfo.duration ? Math.floor(rawInfo.duration % 60) : 0;
          const durationFormatted = rawInfo.duration ? `${mins}:${secs < 10 ? '0' : ''}${secs}` : undefined;

          const formats: VideoFormat[] = sortedHeights.map((h) => ({
            id: `${h}p`,
            format: 'MP4',
            quality: h === 720 ? '720p (HD)' : '480p (SD)',
            resolution: h === 720 ? '1280x720' : '854x480',
            height: h,
            hasAudio: true,
            hasVideo: true,
            isHd: h === 720,
            mediaType: 'video' as const,
            url: `${API_BASE_URL}/api/download?url=${encodeURIComponent(url)}&type=video&quality=${h}`,
          }));

          formats.push({
            id: 'audio-mp3-128k',
            format: 'MP3',
            quality: '128 kbps',
            isAudio: true,
            mediaType: 'audio' as const,
            audioBitrate: 128,
            url: `${API_BASE_URL}/api/download?url=${encodeURIComponent(url)}&type=audio&quality=128`,
          });

          return {
            id: rawInfo.id || 'video',
            title: rawInfo.title || 'Facebook Video',
            author: rawInfo.channel || rawInfo.uploader || 'Facebook Creator',
            thumbnail: rawInfo.thumbnail || '',
            duration: rawInfo.duration ?? null,
            durationFormatted: durationFormatted || null,
            platform: 'facebook',
            platformLabel: 'Facebook',
            formats,
            downloadAvailable: true,
            originalUrl: url,
          };
        }
      }
    }

    if (!response.ok || json.success === false) {
      const errorMsg =
        json.error?.message ||
        (json as unknown as { message?: string }).message ||
        'Failed to retrieve video details.';
      const err = new Error(errorMsg);
      (err as unknown as { code?: string }).code = json.error?.code || 'SERVER_ERROR';
      throw err;
    }

    // Extract payload whether wrapped in data or flat
    const payload = (json.data || json) as VideoInfo;
    payload.originalUrl = payload.originalUrl || url;
    if (json.standardQuality && !payload.standardQuality) {
      payload.standardQuality = json.standardQuality;
    }
    if (json.highQuality && !payload.highQuality) {
      payload.highQuality = json.highQuality;
    }

    // Normalize audio options into formats list if provided separately
    if (json.audio_options && Array.isArray(json.audio_options)) {
      const existingAudio = (payload.formats || []).some((f) => f.isAudio || f.mediaType === 'audio');
      if (!existingAudio) {
        payload.formats = payload.formats || [];
        for (const opt of json.audio_options) {
          const bitrate = opt.audioBitrate || opt.bitrate || 128;
          payload.formats.push({
            id: opt.id || `audio-mp3-${bitrate}k`,
            format: 'MP3',
            quality: opt.quality || `${bitrate} kbps`,
            isAudio: true,
            mediaType: 'audio',
            audioBitrate: bitrate,
            url,
            filesizeFormatted: opt.filesizeFormatted,
          });
        }
      }
    }

    return payload;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      throw new Error('Request timed out. The backend or Facebook service may be responding slowly.');
    }

    // Network connection error
    if (
      (err as Error).message?.includes('Failed to fetch') ||
      (err as Error).message?.includes('NetworkError') ||
      (err as Error).message?.includes('Network request failed')
    ) {
      throw new Error(
        'Backend connection failed. If you have deployed the Python FastAPI backend, ensure VITE_API_BASE_URL is configured with your live HTTPS API URL and CORS is enabled.'
      );
    }

    throw err;
  }
}

// FIX 2: retry once after a short pause when the failure looks like a cold start
export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  try {
    return await fetchVideoInfoOnce(url);
  } catch (e) {
    const m = (e as Error).message || '';
    if (m.includes('timed out') || m.includes('starting up') || m.includes('connection failed')) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return await fetchVideoInfoOnce(url);
    }
    throw e;
  }
}

export async function triggerDownload(options: {
  url: string;
  formatId?: string;
  quality?: 'standard' | 'high' | string;
  targetMediaUrl?: string;
  title?: string;
  mediaType?: 'video' | 'audio';
  audioBitrate?: number;
}): Promise<{ downloadUrl: string; filename: string; download_id?: string }> {
  try {
    const safeTitle = options.title
      ? options.title.trim().length > 190
        ? options.title.trim().slice(0, 187) + '...'
        : options.title.trim()
      : undefined;

    const payload = {
      ...options,
      title: safeTitle,
    };

    const response = await fetch(`${API_BASE_URL}/api/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 404 || response.status === 405) {
      // Fallback for standalone ytdl_api GET /api/download endpoint
      const type = options.mediaType === 'audio' || options.formatId?.startsWith('audio-mp3-') ? 'audio' : 'video';
      let quality = 'best';
      if (type === 'audio') {
        quality = options.audioBitrate ? options.audioBitrate.toString() : '128';
      } else {
        const match = options.formatId?.match(/(\d{3,4})p?/i);
        quality = match ? match[1] : 'best';
      }
      const directUrl = `${API_BASE_URL}/api/download?url=${encodeURIComponent(options.url)}&type=${type}&quality=${quality}`;
      return {
        downloadUrl: directUrl,
        filename: options.title
          ? `${options.title.slice(0, 50)}.${type === 'audio' ? 'mp3' : 'mp4'}`
          : `ClipFetch_media.${type === 'audio' ? 'mp3' : 'mp4'}`,
      };
    }

    const json = (await safeJson(response)) as {
      success: boolean;
      download_id?: string;
      downloadUrl?: string;
      filename?: string;
      error?: { message: string };
      data?: {
        downloadUrl?: string;
        filename?: string;
        download_id?: string;
      };
    };

    if (!response.ok || !json.success) {
      throw new Error(json.error?.message || 'Download preparation failed.');
    }

    const rawUrl = json.data?.downloadUrl || json.downloadUrl || '';
    const resolvedFilename = json.data?.filename || json.filename || 'ClipFetch_Video.mp4';

    let downloadEndpoint = rawUrl;
    if (downloadEndpoint.startsWith('http://') || downloadEndpoint.startsWith('https://')) {
      try {
        const parsed = new URL(downloadEndpoint);
        downloadEndpoint = `${parsed.pathname}${parsed.search}`;
      } catch {}
    } else if (!downloadEndpoint.startsWith('/')) {
      downloadEndpoint = `/${downloadEndpoint}`;
    }

    const resolvedDownloadId = json.download_id || json.data?.download_id;

    return {
      downloadUrl: downloadEndpoint,
      filename: resolvedFilename,
      download_id: resolvedDownloadId,
    };
  } catch (err: unknown) {
    if ((err as Error).message?.includes('Failed to fetch')) {
      throw new Error(
        'Backend connection failed during download. Please check that your backend service is running and accessible.'
      );
    }
    throw err;
  }
}