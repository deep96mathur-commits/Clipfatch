export type PlatformType = 'facebook' | 'unknown';

export interface VideoFormat {
  id: string;
  format: string; // 'MP4' or 'MP3'
  quality: string; // e.g., '480p (SD)', '720p (HD)', '1080p (Full HD)', '48 kbps', '128 kbps', '320 kbps'
  resolution?: string; // e.g., '854x480', '1280x720', '1920x1080'
  height?: number;
  filesize?: number;
  filesizeFormatted?: string;
  url: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  isHd?: boolean;
  isAudio?: boolean;
  audioBitrate?: number; // 48, 128, 320
  mediaType?: 'video' | 'audio';
}

export interface VideoInfo {
  platform: PlatformType;
  platformLabel: string;
  id?: string;
  title: string | null;
  description?: string | null;
  author?: string | null;
  thumbnail: string | null;
  duration: number | null;
  durationFormatted: string | null;
  formats: VideoFormat[];
  standardQuality?: VideoFormat | null;
  highQuality?: VideoFormat | null;
  downloadAvailable: boolean;
  message?: string;
  originalUrl: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export type ModalType = 'privacy' | 'terms' | 'copyright' | null;
