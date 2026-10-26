import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface MediaStreamInfo {
  index: number;
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string | number;
}

export interface MediaProbeResult {
  isValid: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  formatName?: string;
  duration?: number;
  size?: number;
  audioBitrate?: number;
  error?: string;
}

/**
 * Inspects a media file using ffprobe and returns structured stream metadata.
 */
export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type,codec_name,width,height,bit_rate',
        '-show_entries',
        'format=format_name,duration,size',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 10000 }
    );

    const data = JSON.parse(stdout);
    const streams: MediaStreamInfo[] = Array.isArray(data.streams) ? data.streams : [];
    const format = data.format || {};

    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    const hasVideo = !!videoStream;
    const hasAudio = !!audioStream;
    const size = format.size ? parseInt(format.size, 10) : undefined;
    const duration = format.duration ? parseFloat(format.duration) : undefined;

    let audioBitrate: number | undefined;
    if (audioStream?.bit_rate) {
      audioBitrate = Math.round(parseInt(String(audioStream.bit_rate), 10) / 1000);
    }

    return {
      isValid: (hasVideo || hasAudio) && (size === undefined || size > 0),
      hasVideo,
      hasAudio,
      videoCodec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      width: videoStream?.width,
      height: videoStream?.height,
      formatName: format.format_name,
      duration,
      size,
      audioBitrate,
    };
  } catch (err: unknown) {
    return {
      isValid: false,
      hasVideo: false,
      hasAudio: false,
      error: (err as Error).message || 'Failed to probe media file with ffprobe',
    };
  }
}
