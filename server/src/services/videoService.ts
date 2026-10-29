import { validateAndClassifyUrl } from '../utils/ssrfGuard.js';
import { adapterRegistry } from './adapters/AdapterRegistry.js';
import { VideoInfoResult } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

interface CacheEntry {
  data: VideoInfoResult;
  expiresAt: number;
}

// In-memory TTL cache for video metadata (5-minute TTL, max 100 entries)
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;
const videoInfoCache = new Map<string, CacheEntry>();

export function getCachedVideoInfo(rawUrl: string): VideoInfoResult | null {
  const key = rawUrl.trim();
  const entry = videoInfoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    videoInfoCache.delete(key);
    return null;
  }
  return JSON.parse(JSON.stringify(entry.data));
}

export function setCachedVideoInfo(rawUrl: string, data: VideoInfoResult, ttlMs = CACHE_TTL_MS): void {
  const key = rawUrl.trim();
  if (videoInfoCache.size >= MAX_CACHE_SIZE) {
    const firstKey = videoInfoCache.keys().next().value;
    if (firstKey) videoInfoCache.delete(firstKey);
  }
  videoInfoCache.set(key, {
    data: JSON.parse(JSON.stringify(data)),
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearVideoInfoCache(): void {
  videoInfoCache.clear();
}

export async function processVideoInfo(rawUrl: string): Promise<VideoInfoResult> {
  const cleanUrl = rawUrl.trim();
  const cached = getCachedVideoInfo(cleanUrl);
  if (cached) {
    return cached;
  }

  const validation = await validateAndClassifyUrl(cleanUrl);

  if (!validation.safe) {
    throw new AppError(
      validation.error || 'The submitted URL is not supported or failed security validation',
      400,
      'INVALID_URL'
    );
  }

  const adapter = adapterRegistry.getAdapter(validation.parsedUrl);
  if (!adapter) {
    throw new AppError(
      `No adapter registered for platform: ${validation.platform}`,
      400,
      'UNSUPPORTED_PLATFORM'
    );
  }

  try {
    const info = await adapter.getVideoInfo(cleanUrl, validation.parsedUrl);
    if (info && info.title && info.title.length > 190) {
      info.title = info.title.slice(0, 187) + '...';
    }
    if (info) {
      setCachedVideoInfo(cleanUrl, info);
    }
    return info;
  } catch (err) {
    throw new AppError(
      'Unable to retrieve video information. The video may be private, deleted, or require login.',
      422,
      'RETRIEVAL_FAILED'
    );
  }
}

