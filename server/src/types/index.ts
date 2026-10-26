export type PlatformType = 'facebook' | 'unknown';

export interface VideoFormat {
  id: string;
  format: string; // 'MP4' or 'MP3'
  quality: string; // e.g., '480p (SD)', '720p (HD)', '1080p (Full HD)', '48 kbps', '128 kbps', '320 kbps'
  resolution?: string; // e.g., '854x480', '1280x720', '1920x1080'
  height?: number; // numeric height for sorting (360, 480, 720, 1080)
  filesize?: number; // size in bytes if known
  filesizeFormatted?: string; // e.g., '12.4 MB'
  url: string; // direct authorized media URL
  hasAudio?: boolean;
  hasVideo?: boolean;
  isHd?: boolean;
  isAudio?: boolean; // true for MP3 audio tracks
  audioBitrate?: number; // e.g., 48, 128, 320
  mediaType?: 'video' | 'audio';
}

export interface VideoInfoResult {
  platform: PlatformType;
  platformLabel: string;
  id?: string;
  title: string | null;
  description?: string | null;
  author?: string | null;
  thumbnail: string | null;
  duration: number | null; // in seconds
  durationFormatted: string | null; // e.g. "00:28"
  formats: VideoFormat[];
  standardQuality?: VideoFormat | null;
  highQuality?: VideoFormat | null;
  downloadAvailable: boolean;
  message?: string;
  originalUrl: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}
