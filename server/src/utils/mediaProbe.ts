import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileAsync = promisify(execFile);

/**
 * Dynamically resolves the best available ffprobe binary path.
 */
export function getFfprobeBinary(): string {
  const candidates = [
    process.env.FFPROBE_PATH,
    '/usr/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    'ffprobe',
  ];
  for (const c of candidates) {
    if (c) {
      if (c.startsWith('/') || c.startsWith('.')) {
        if (fs.existsSync(c)) return c;
      } else {
        return c;
      }
    }
  }
  return 'ffprobe';
}

/**
 * Dynamically resolves the best available ffmpeg binary path.
 */
export function getFfmpegBinary(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ];
  for (const c of candidates) {
    if (c) {
      if (c.startsWith('/') || c.startsWith('.')) {
        if (fs.existsSync(c)) return c;
      } else {
        return c;
      }
    }
  }
  return 'ffmpeg';
}

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

export interface VideoOutputVerificationResult {
  valid: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  reason?: string;
  probe?: MediaProbeResult;
}

/**
 * Inspects a media file using ffprobe and returns structured stream metadata.
 */
export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  try {
    const ffprobeBin = getFfprobeBinary();
    const { stdout } = await execFileAsync(
      ffprobeBin,
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

/**
 * Validates that a video download file contains a valid video stream,
 * and if requireAudio is true, confirms that a playable audio stream is present.
 * Rejects silent video files, audio-only files, or corrupt/missing files.
 */
export async function verifyVideoOutput(
  filePath: string,
  requireAudio: boolean = true
): Promise<VideoOutputVerificationResult> {
  if (!fs.existsSync(filePath)) {
    return { valid: false, hasVideo: false, hasAudio: false, reason: 'Media file does not exist on disk' };
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return {
      valid: false,
      hasVideo: false,
      hasAudio: false,
      reason: 'Media file is empty (0 bytes)',
    };
  }

  const probe = await probeMediaFile(filePath);
  if (!probe.isValid) {
    return {
      valid: false,
      hasVideo: false,
      hasAudio: false,
      reason: probe.error || 'Failed to probe media streams with ffprobe',
      probe,
    };
  }

  if (!probe.hasVideo) {
    return {
      valid: false,
      hasVideo: false,
      hasAudio: probe.hasAudio,
      reason: 'Output file does not contain a video stream',
      probe,
    };
  }

  if (requireAudio && !probe.hasAudio) {
    return {
      valid: false,
      hasVideo: true,
      hasAudio: false,
      reason: 'Missing audio stream: video output has no sound',
      probe,
    };
  }

  return {
    valid: true,
    hasVideo: true,
    hasAudio: probe.hasAudio,
    probe,
  };
}
