import { VideoFormat } from '../types/index.js';

/**
 * Extracts numeric height from a format, resolution string, or quality label.
 */
export function parseFormatHeight(fmt: Partial<VideoFormat>): number {
  if (fmt.height && fmt.height > 0) return fmt.height;

  if (fmt.quality) {
    const match = fmt.quality.match(/(\d{3,4})\s*p?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    const qLower = fmt.quality.toLowerCase();
    if (qLower.includes('4k') || qLower.includes('2160')) return 2160;
    if (qLower.includes('2k') || qLower.includes('1440')) return 1440;
    if (qLower.includes('full hd') || qLower.includes('1080') || qLower.includes('fhd')) return 1080;
    if (qLower.includes('hd') || qLower.includes('720')) return 720;
    if (qLower.includes('sd') || qLower.includes('480')) return 480;
    if (qLower.includes('360')) return 360;
    if (qLower.includes('240')) return 240;
  }

  if (fmt.resolution) {
    const match = fmt.resolution.match(/(\d+)\s*[xX*×]\s*(\d+)/);
    if (match) {
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      return Math.min(w, h); // Height is usually the smaller dimension in landscape or larger in portrait
    }
  }

  if (fmt.id) {
    const idLower = fmt.id.toLowerCase();
    if (idLower.includes('2160') || idLower.includes('4k')) return 2160;
    if (idLower.includes('1440') || idLower.includes('2k')) return 1440;
    if (idLower.includes('1080') || idLower.includes('full hd') || idLower.includes('fhd')) return 1080;
    if (idLower.includes('720') || idLower.includes('hd')) return 720;
    if (idLower.includes('480') || idLower.includes('sd')) return 480;
    if (idLower.includes('360')) return 360;
    if (idLower.includes('240')) return 240;

    const match = fmt.id.match(/(\d{3,4})\s*p?/i);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val >= 144 && val <= 4320) return val;
    }
  }

  return 480; // Default fallback
}

/**
 * Normalizes quality display label according to industry standard conventions.
 */
export function getQualityLabel(height: number): string {
  if (height >= 2160) return '2160p (4K)';
  if (height >= 1440) return '1440p (2K)';
  if (height >= 1080) return '1080p (Full HD)';
  if (height >= 720) return '720p (HD)';
  if (height >= 480) return '480p (SD)';
  if (height >= 360) return '360p';
  if (height >= 240) return '240p';
  return `${height}p`;
}

/**
 * Standardizes resolution display text.
 */
export function getStandardResolution(height: number, existing?: string): string {
  if (existing && existing.includes('x')) return existing;
  if (height >= 2160) return '3840x2160';
  if (height >= 1440) return '2560x1440';
  if (height >= 1080) return '1920x1080';
  if (height >= 720) return '1280x720';
  if (height >= 480) return '854x480';
  if (height >= 360) return '640x360';
  return `${Math.round(height * 16 / 9)}x${height}`;
}

/**
 * Deduplicates and sorts video formats in ASCENDING resolution order (lowest to highest).
 * For duplicate heights, picks the single best candidate (preferring progressive audio+video).
 */
export function deduplicateAndSortVideoFormats(formats: VideoFormat[]): VideoFormat[] {
  // Separate video formats from audio formats
  const videoCandidates = formats.filter((f) => !f.isAudio && f.mediaType !== 'audio');
  const heightGroups = new Map<number, VideoFormat>();

  for (const fmt of videoCandidates) {
    const height = parseFormatHeight(fmt);
    const existing = heightGroups.get(height);

    if (!existing) {
      heightGroups.set(height, {
        ...fmt,
        height,
        format: 'MP4',
        quality: getQualityLabel(height),
        resolution: getStandardResolution(height, fmt.resolution),
        isHd: height >= 720,
        mediaType: 'video',
      });
      continue;
    }

    // Tie-breaking:
    // 1. Prefer formats with both audio and video
    const existingBoth = existing.hasAudio && existing.hasVideo;
    const currentBoth = fmt.hasAudio && fmt.hasVideo;

    if (!existingBoth && currentBoth) {
      heightGroups.set(height, {
        ...fmt,
        height,
        format: 'MP4',
        quality: getQualityLabel(height),
        resolution: getStandardResolution(height, fmt.resolution),
        isHd: height >= 720,
        mediaType: 'video',
      });
    } else if (existingBoth === currentBoth) {
      // 2. Prefer format with known filesize or larger filesize
      const existingSize = existing.filesize || 0;
      const currentSize = fmt.filesize || 0;
      if (currentSize > existingSize) {
        heightGroups.set(height, {
          ...fmt,
          height,
          format: 'MP4',
          quality: getQualityLabel(height),
          resolution: getStandardResolution(height, fmt.resolution),
          isHd: height >= 720,
          mediaType: 'video',
        });
      }
    }
  }

  // Filter to only allow 480p and 720p video formats
  const allowed = Array.from(heightGroups.values()).filter(
    (f) => f.height === 480 || f.height === 720
  );

  // If neither 480 nor 720 existed directly, map closest to 480 and 720
  if (allowed.length === 0 && heightGroups.size > 0) {
    const all = Array.from(heightGroups.values());
    const closest480 = [...all].sort((a, b) => Math.abs((a.height || 480) - 480) - Math.abs((b.height || 480) - 480))[0];
    allowed.push({
      ...closest480,
      id: 'fb-480p',
      height: 480,
      quality: '480p (SD)',
      resolution: '854x480',
      isHd: false,
    });
    const highest = [...all].sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    allowed.push({
      ...highest,
      id: 'fb-720p',
      height: 720,
      quality: '720p (HD)',
      resolution: '1280x720',
      isHd: true,
    });
  }

  // Sort by height ASCENDING: 480p first, then 720p
  const sorted = allowed.sort((a, b) => (a.height || 0) - (b.height || 0));
  return sorted;
}

/**
 * Generates standard MP3 audio download option (128 kbps only).
 */
export function generateAudioFormats(sourceUrl: string, duration?: number | null): VideoFormat[] {
  const kbps = 128;
  let filesizeFormatted: string | undefined;
  let filesize: number | undefined;

  if (duration && duration > 0) {
    const bytes = Math.round(((kbps * 1000) / 8) * duration);
    filesize = bytes;
    filesizeFormatted = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return [
    {
      id: 'audio-mp3-128k',
      format: 'MP3',
      quality: '128 kbps',
      url: sourceUrl,
      filesize,
      filesizeFormatted,
      isAudio: true,
      hasAudio: true,
      hasVideo: false,
      isHd: false,
      audioBitrate: 128,
      mediaType: 'audio',
    },
  ];
}

export interface QualitySelectionResult {
  standard: VideoFormat | null;
  high: VideoFormat | null;
}

/**
 * Selects exactly two formats:
 * - Standard Quality: 480p (SD)
 * - High Quality: 720p (HD)
 */
export function selectStandardAndHighFormats(formats: VideoFormat[]): QualitySelectionResult {
  const videoFormats = formats.filter((f) => !f.isAudio && f.mediaType !== 'audio');
  if (videoFormats.length === 0) {
    return { standard: null, high: null };
  }

  // High Quality: 720p
  const high =
    videoFormats.find((f) => f.height === 720) ||
    videoFormats.find((f) => f.id.includes('720')) ||
    videoFormats[videoFormats.length - 1];

  // Standard Quality: 480p
  const standard =
    videoFormats.find((f) => f.height === 480) ||
    videoFormats.find((f) => f.id.includes('480')) ||
    videoFormats[0];

  return { standard, high };
}
