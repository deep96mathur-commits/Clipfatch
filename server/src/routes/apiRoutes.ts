import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import {
  videoInfoSchema,
  videoDownloadSchema,
  videoInfoQuerySchema,
  downloadQuerySchema,
  videoStreamQuerySchema,
} from '../validators/videoValidator.js';
import { processVideoInfo } from '../services/videoService.js';
import { streamMediaToClient, sanitizeFilename } from '../services/downloadService.js';
import { validateMediaDownloadUrl } from '../utils/ssrfGuard.js';
import { selectStandardAndHighFormats } from '../utils/formatNormalizer.js';
import { VideoFormat } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const apiRouter = Router();

// In-memory store for secure, short-lived download tokens (15-minute TTL)
interface DownloadTicket {
  id: string;
  url: string;
  pageUrl: string;
  formatId?: string;
  mediaType: 'video' | 'audio';
  audioBitrate?: number;
  title?: string;
  filename: string;
  createdAt: number;
}

const ticketStore = new Map<string, DownloadTicket>();

// Periodic cleanup of expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of ticketStore.entries()) {
    if (now - ticket.createdAt > 15 * 60 * 1000) {
      ticketStore.delete(id);
    }
  }
}, 60 * 1000).unref();

function checkBinary(paths: string[]): boolean {
  for (const p of paths) {
    if (fs.existsSync(p)) return true;
  }
  return false;
}

// GET /api/health - Dependency checks and operational status
apiRouter.get('/health', (_req: Request, res: Response) => {
  const hasFfmpeg = checkBinary(['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);
  const hasFfprobe = checkBinary(['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe']);
  const hasYtDlp = checkBinary(['/usr/local/bin/yt-dlp', '/app/applet/bin/yt-dlp', 'yt-dlp']);

  return res.json({
    success: true,
    data: {
      status: 'operational',
      version: '1.2.0',
      service: 'ClipFetch API',
      timestamp: new Date().toISOString(),
      supportedPlatforms: ['facebook'],
      dependencies: {
        ffmpeg: hasFfmpeg,
        ffprobe: hasFfprobe,
        ytdlp: hasYtDlp,
      },
      features: ['video_download', 'mp3_audio_extraction', 'ffmpeg_muxing', 'ssrf_guard'],
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
});

/**
 * Common handler for URL analysis.
 */
async function handleAnalyze(rawUrl: string) {
  const videoData = await processVideoInfo(rawUrl);

  const videoFormats = videoData.formats
    .filter((f) => !f.isAudio && f.mediaType !== 'audio')
    .filter((f) => f.height === 480 || f.height === 720);

  const qualitySelection = selectStandardAndHighFormats(videoFormats);
  const standardQuality = videoData.standardQuality || qualitySelection.standard;
  const highQuality = videoData.highQuality || qualitySelection.high;

  // Ensure videoData carries standardQuality and highQuality
  videoData.standardQuality = standardQuality;
  videoData.highQuality = highQuality;

  const audioOptions = videoData.formats
    .filter((f) => f.isAudio || f.mediaType === 'audio')
    .filter((f) => f.audioBitrate === 128 || f.id.includes('128'))
    .map((f) => ({
      id: 'audio-mp3-128k',
      format: 'mp3',
      bitrate: 128,
      label: '128 kbps (MP3 Audio)',
      filesizeFormatted: f.filesizeFormatted,
    }));

  return {
    success: true,
    platform: videoData.platform,
    platformLabel: videoData.platformLabel,
    title: videoData.title,
    author: videoData.author,
    thumbnail: videoData.thumbnail,
    duration: videoData.duration,
    durationFormatted: videoData.durationFormatted,
    standardQuality,
    highQuality,
    formats: videoFormats.map((f) => ({
      id: f.id,
      resolution: f.resolution || f.quality,
      quality: f.quality,
      ext: 'mp4',
      has_audio: f.hasAudio ?? true,
      has_video: f.hasVideo ?? true,
      height: f.height,
      is_hd: f.height === 720,
      filesize: f.filesize,
      filesizeFormatted: f.filesizeFormatted,
      url: f.url,
    })),
    audio_options: audioOptions.length > 0 ? audioOptions : [
      { id: 'audio-mp3-128k', format: 'mp3', bitrate: 128, label: '128 kbps (MP3 Audio)' },
    ],
    downloadAvailable: videoData.downloadAvailable,
    message: videoData.message,
    data: videoData, // Preserved for direct frontend consumption
  };
}

// POST /api/analyze - Standard API endpoint
apiRouter.post('/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = videoInfoSchema.parse(req.body);
    const result = await handleAnalyze(validated.url);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/video/info - Backward compatibility endpoint
apiRouter.post('/video/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = videoInfoSchema.parse(req.body);
    const videoData = await processVideoInfo(validated.url);

    return res.json({
      success: true,
      data: videoData,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/info - YouTube & media info endpoint (compatible with ytdl_api)
apiRouter.get('/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = videoInfoQuerySchema.parse(req.query);
    const videoData = await processVideoInfo(validated.url);

    const heights = videoData.formats
      .filter((f) => !f.isAudio && f.height && f.height >= 144)
      .map((f) => f.height as number);
    const uniqueHeights = Array.from(new Set(heights)).sort((a, b) => b - a);

    return res.json({
      id: videoData.id,
      title: videoData.title,
      channel: videoData.author,
      duration: videoData.duration,
      thumbnail: videoData.thumbnail,
      is_live: false,
      available_heights: uniqueHeights,
      success: true,
      platform: videoData.platform,
      platformLabel: videoData.platformLabel,
      formats: videoData.formats,
      data: videoData,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/info - Support JSON body { url }
apiRouter.post('/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawUrl =
      typeof req.body?.url === 'string'
        ? req.body.url
        : typeof req.query?.url === 'string'
          ? req.query.url
          : undefined;

    const validated = videoInfoSchema.parse({ url: rawUrl });
    const videoData = await processVideoInfo(validated.url);

    return res.json({
      url: validated.url,
      title: (videoData.title || 'Instagram Reel').slice(0, 140),
      uploader: videoData.author || null,
      thumbnail: videoData.thumbnail || null,
      duration: videoData.duration || null,
      formats: videoData.formats,
      data: videoData,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Common handler for preparing a media download.
 */
async function handleDownloadPreparation(body: unknown) {
  const validated = videoDownloadSchema.parse(body);

  const effectiveFormatId = validated.formatId || validated.format_id;
  const effectiveMediaType: 'video' | 'audio' =
    validated.mediaType ||
    validated.type ||
    (effectiveFormatId?.startsWith('audio-mp3-') ? 'audio' : 'video');

  const effectiveBitrate =
    validated.audioBitrate ||
    validated.bitrate ||
    (effectiveFormatId ? parseInt(effectiveFormatId.replace(/[^0-9]/g, ''), 10) : 128);

  const safeBitrate = [48, 128, 320].includes(effectiveBitrate) ? effectiveBitrate : 128;
  const isAudio = effectiveMediaType === 'audio';

  // 1. Audio preparation
  if (isAudio) {
    const baseName = sanitizeFilename(validated.title, 'ClipFetch_audio', 'mp3').replace(/\.mp3$/i, '');
    const filename = `${baseName}_${safeBitrate}kbps.mp3`;

    const ticketId = crypto.randomUUID();
    ticketStore.set(ticketId, {
      id: ticketId,
      url: validated.targetMediaUrl || validated.url,
      pageUrl: validated.url,
      formatId: effectiveFormatId || `audio-mp3-${safeBitrate}k`,
      mediaType: 'audio',
      audioBitrate: safeBitrate,
      title: validated.title,
      filename,
      createdAt: Date.now(),
    });

    const downloadEndpoint = `/api/download-file/${ticketId}`;
    return {
      success: true,
      download_id: ticketId,
      downloadUrl: downloadEndpoint,
      filename,
      data: {
        downloadUrl: downloadEndpoint,
        directUrl: validated.url,
        filename,
        download_id: ticketId,
        message: 'Audio conversion ready. Streaming MP3.',
      },
    };
  }

  // 2. Direct media target URL
  if (validated.targetMediaUrl) {
    const mediaCheck = await validateMediaDownloadUrl(validated.targetMediaUrl);
    if (!mediaCheck.safe) {
      throw new AppError(
        mediaCheck.error || 'Requested download target is not authorized',
        403,
        'INVALID_MEDIA_TARGET'
      );
    }

    const filename = sanitizeFilename(validated.title, 'ClipFetch_video', 'mp4');
    const ticketId = crypto.randomUUID();
    ticketStore.set(ticketId, {
      id: ticketId,
      url: validated.targetMediaUrl,
      pageUrl: validated.url,
      formatId: effectiveFormatId,
      mediaType: 'video',
      title: validated.title,
      filename,
      createdAt: Date.now(),
    });

    const downloadEndpoint = `/api/download-file/${ticketId}`;
    return {
      success: true,
      download_id: ticketId,
      downloadUrl: downloadEndpoint,
      filename,
      data: {
        downloadUrl: downloadEndpoint,
        directUrl: validated.targetMediaUrl,
        filename,
        download_id: ticketId,
        message: 'Download ready. Streaming MP4.',
      },
    };
  }

  // 3. Resolve through adapter to find active format URL
  const videoData = await processVideoInfo(validated.url);
  if (!videoData.downloadAvailable || videoData.formats.length === 0) {
    throw new AppError(
      videoData.message || 'Direct media download is not currently available for this URL',
      404,
      'DOWNLOAD_UNAVAILABLE'
    );
  }

  let selectedFormat: VideoFormat;
  const qualitySelection = selectStandardAndHighFormats(videoData.formats);

  if (
    validated.quality === 'standard' ||
    effectiveFormatId === 'standard' ||
    effectiveFormatId === 'standard_quality'
  ) {
    selectedFormat = qualitySelection.standard || videoData.formats[0];
  } else if (
    validated.quality === 'high' ||
    effectiveFormatId === 'high' ||
    effectiveFormatId === 'high_quality'
  ) {
    selectedFormat = qualitySelection.high || videoData.formats[videoData.formats.length - 1];
  } else if (effectiveFormatId) {
    selectedFormat =
      videoData.formats.find((f) => f.id === effectiveFormatId) || videoData.formats[0];
  } else {
    selectedFormat = qualitySelection.high || videoData.formats[0];
  }

  const filename = sanitizeFilename(videoData.title || undefined, `${videoData.platform}_video`, 'mp4');
  const ticketId = crypto.randomUUID();
  ticketStore.set(ticketId, {
    id: ticketId,
    url: selectedFormat.url,
    pageUrl: validated.url,
    formatId: selectedFormat.id,
    mediaType: 'video',
    title: videoData.title || `${videoData.platform}_video`,
    filename,
    createdAt: Date.now(),
  });

  const downloadEndpoint = `/api/download-file/${ticketId}`;
  return {
    success: true,
    download_id: ticketId,
    downloadUrl: downloadEndpoint,
    filename,
    data: {
      format: selectedFormat,
      downloadUrl: downloadEndpoint,
      directUrl: selectedFormat.url,
      filename,
      download_id: ticketId,
    },
  };
}

// POST /api/download - Standard download preparation endpoint
apiRouter.post('/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handleDownloadPreparation(req.body);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/video/download - Backward compatibility download endpoint
apiRouter.post('/video/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handleDownloadPreparation(req.body);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET or HEAD /api/check - Lightweight health and cookie check endpoint
apiRouter.all('/check', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.status(200).json({ status: 'ok', time: Date.now() });
});

// HEAD /api/download - Lightweight pre-check endpoint
apiRouter.head('/download', (req: Request, res: Response) => {
  const typeParam = typeof req.query.type === 'string' ? req.query.type : 'video';
  const type = typeParam === 'audio' ? 'audio' : 'video';
  res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="ClipFetch_${type === 'audio' ? 'audio.mp3' : 'media.mp4'}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.status(200).end();
});

// GET /api/download - Direct streaming download endpoint (compatible with ytdl_api)
apiRouter.get('/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = downloadQuerySchema.parse(req.query);
    const rawUrl = validated.url;
    const type = validated.type;
    const quality = validated.quality;
    const title = validated.title;

    if (type === 'audio') {
      try {
        await streamMediaToClient(rawUrl, res, title, rawUrl, 'audio-mp3-128k', 'audio', 128);
      } catch (audioErr: unknown) {
        console.error('[Download] Audio extraction error:', (audioErr as Error)?.message);
        if (!res.headersSent) {
          return res.status(502).json({
            success: false,
            error: {
              code: 'AUDIO_EXTRACTION_FAILED',
              message: 'Failed to process audio download. Please try again later.',
            },
          });
        }
      }
      return;
    }

    // Video download: only two formats: 480p (Standard) and 720p (High)
    let formatId = '720p';
    if (quality === 'standard' || quality === 'sd' || quality === '480') {
      formatId = '480p';
    } else {
      formatId = '720p';
    }
    await streamMediaToClient(rawUrl, res, title, rawUrl, formatId, 'video');
  } catch (err) {
    next(err);
  }
});

// HEAD /api/download-file/:download_id - Lightweight pre-check endpoint for download tickets
apiRouter.head('/download-file/:download_id', (req: Request, res: Response) => {
  const downloadId = req.params.download_id;
  const ticket = ticketStore.get(downloadId);
  if (!ticket) {
    return res.status(404).end();
  }
  res.setHeader('Content-Type', ticket.mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${ticket.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.status(200).end();
});

// GET /api/download-file/:download_id - Secure token-based file streaming endpoint
apiRouter.get('/download-file/:download_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const downloadId = req.params.download_id;
    const ticket = ticketStore.get(downloadId);

    if (!ticket) {
      throw new AppError('The requested download link is invalid or has expired. Please try again.', 404, 'TICKET_NOT_FOUND');
    }

    if (ticket.mediaType === 'audio') {
      try {
        await streamMediaToClient(
          ticket.url,
          res,
          ticket.title,
          ticket.pageUrl,
          ticket.formatId,
          ticket.mediaType,
          ticket.audioBitrate
        );
      } catch (audioErr: unknown) {
        console.error('[Download] Ticket audio extraction error:', (audioErr as Error)?.message);
        if (!res.headersSent) {
          return res.status(502).json({
            success: false,
            error: {
              code: 'AUDIO_EXTRACTION_FAILED',
              message: 'Failed to process audio download. Please try again later.',
            },
          });
        }
      }
      return;
    }

    await streamMediaToClient(
      ticket.url,
      res,
      ticket.title,
      ticket.pageUrl,
      ticket.formatId,
      ticket.mediaType,
      ticket.audioBitrate
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/video/stream - Backward compatibility query-param streaming endpoint
apiRouter.get('/video/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = videoStreamQuerySchema.parse(req.query);
    const rawUrl = validated.url;
    const title = validated.title;
    const pageUrl = validated.pageUrl;
    const formatId = validated.formatId;
    const mediaType = validated.mediaType;
    const audioBitrate = validated.audioBitrate ? parseInt(validated.audioBitrate, 10) : undefined;

    await streamMediaToClient(rawUrl || '', res, title, pageUrl, formatId, mediaType, audioBitrate);
  } catch (err) {
    next(err);
  }
});
