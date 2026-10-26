import { PlatformType, VideoInfoResult, VideoFormat } from '../../types/index.js';

export interface PlatformAdapter {
  readonly platform: PlatformType;
  readonly platformLabel: string;
  supportsUrl(parsedUrl: URL): boolean;
  getVideoInfo(url: string, parsedUrl: URL): Promise<VideoInfoResult>;
  getAvailableFormats(mediaData: unknown): Promise<VideoFormat[]>;
}
