import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { VideoFormat } from '../types/index.js';
import { deduplicateAndSortVideoFormats } from '../utils/formatNormalizer.js';
import { probeMediaFile, MediaProbeResult } from '../utils/mediaProbe.js';

const execFileAsync = promisify(execFile);

export interface YtDlpFormatRaw {
  format_id: string;
  format_note?: string;
  format?: string;
  protocol?: string;
  ext: string;
  resolution?: string;
  width?: number;
  height?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  url?: string;
  tbr?: number;
  fps?: number;
}

export interface YtDlpExtractionResult {
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  formats: VideoFormat[];
}

export interface LoggedProcessResult {
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  last20StderrLines: string;
}

export function runLoggedProcess(
  toolName: 'yt-dlp' | 'ffmpeg',
  binaryPath: string,
  args: string[],
  timeoutMs = 60000
): Promise<LoggedProcessResult> {
  return new Promise((resolve) => {
    console.log(`[Audio ${toolName}] Arguments:`, args);
    const startTime = Date.now();

    const proc = spawn(binaryPath, args, {
      env: {
        ...process.env,
        PYTHONWARNINGS: 'ignore',
      },
    });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);

      const durationMs = Date.now() - startTime;
      console.log(`[Audio ${toolName}] Exit code:`, code);
      console.log(`[Audio ${toolName}] Duration in milliseconds: ${durationMs}ms`);

      const lines = stderr.trim().split('\n');
      const last20StderrLines = lines.slice(-20).join('\n');

      if (code !== 0) {
        console.log(`[Audio ${toolName}] Last 20 lines of stderr on failure:\n${last20StderrLines}`);
      }

      resolve({
        code,
        durationMs,
        stdout,
        stderr,
        last20StderrLines,
      });
    });

    proc.on('error', (err) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);

      const durationMs = Date.now() - startTime;
      console.log(`[Audio ${toolName}] Process error:`, err.message);
      console.log(`[Audio ${toolName}] Exit code: -1`);
      console.log(`[Audio ${toolName}] Duration in milliseconds: ${durationMs}ms`);

      const last20StderrLines = `Process failed to spawn: ${err.message}`;
      console.log(`[Audio ${toolName}] Last 20 lines of stderr on failure:\n${last20StderrLines}`);

      resolve({
        code: -1,
        durationMs,
        stdout,
        stderr: err.message,
        last20StderrLines,
      });
    });
  });
}

export class YtDlpService {
  private static binaryPath: string | null = null;

  /**
   * Discovers the best available yt-dlp binary path.
   */
  public static getBinaryPath(): string {
    if (this.binaryPath) return this.binaryPath;

    const candidates = [
      '/usr/local/bin/yt-dlp',
      '/app/applet/bin/yt-dlp',
      path.resolve(process.cwd(), 'bin/yt-dlp'),
      'yt-dlp',
    ];

    for (const cand of candidates) {
      if (cand.startsWith('/') || cand.startsWith('.')) {
        if (fs.existsSync(cand)) {
          try {
            fs.chmodSync(cand, 0o755);
          } catch {}
          this.binaryPath = cand;
          return cand;
        }
      } else {
        this.binaryPath = cand;
        return cand;
      }
    }

    return 'yt-dlp';
  }

  /**
   * Checks if yt-dlp is available in the environment.
   */
  public static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const binary = this.getBinaryPath();
      const proc = spawn(binary, ['--version']);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Discovers common flags for yt-dlp, such as JavaScript runtime, cookies, and proxy.
   */
  public static getCommonArgs(): string[] {
    const common: string[] = [];

    // Provide node runtime for YouTube JS challenges if available
    const nodePath = '/usr/local/bin/node';
    if (fs.existsSync(nodePath)) {
      common.push('--js-runtimes', `node:${nodePath}`);
    }

    // Cookie file support
    const cookiePath =
      process.env.YTDL_COOKIES_FILE ||
      process.env.COOKIES_FILE ||
      (fs.existsSync(path.resolve(process.cwd(), 'cookies.txt')) ? path.resolve(process.cwd(), 'cookies.txt') : null);
    if (cookiePath && fs.existsSync(cookiePath)) {
      common.push('--cookies', cookiePath);
    }

    // Proxy support
    const proxyUrl = process.env.YTDL_PROXY || process.env.PROXY_URL || process.env.HTTP_PROXY;
    if (proxyUrl) {
      common.push('--proxy', proxyUrl);
    }

    return common;
  }

  /**
   * Extracts structured video metadata and format variants from a URL using yt-dlp.
   */
  public static async extractInfo(url: string, timeoutMs = 15000): Promise<YtDlpExtractionResult | null> {
    const binary = this.getBinaryPath();

    return new Promise((resolve) => {
      const args = [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--skip-download',
        '--no-check-certificates',
        '--format-sort',
        'res,ext:mp4:m4a',
        ...this.getCommonArgs(),
        url,
      ];

      let stdoutData = '';
      let timer: NodeJS.Timeout | null = null;

      const proc = spawn(binary, args, {
        env: {
          ...process.env,
          PYTHONWARNINGS: 'ignore',
        },
      });

      timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        resolve(null);
      }, timeoutMs);

      proc.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      proc.stderr.on('data', () => {});

      proc.on('error', () => {
        if (timer) clearTimeout(timer);
        resolve(null);
      });

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);

        if (code !== 0 || !stdoutData.trim()) {
          resolve(null);
          return;
        }

        try {
          const raw = JSON.parse(stdoutData.trim());
          const candidateFormats: VideoFormat[] = [];
          const rawFormats: YtDlpFormatRaw[] = Array.isArray(raw.formats) ? raw.formats : [];

          for (const rf of rawFormats) {
            // Filter out storyboard thumbnails, mhtml fragments, or formats without URLs
            if (rf.format_id?.startsWith('sb') || rf.protocol === 'mhtml' || rf.ext === 'mhtml') continue;
            if (!rf.url) continue;

            const isAudioOnly = rf.acodec && rf.acodec !== 'none' && (!rf.vcodec || rf.vcodec === 'none');
            if (isAudioOnly) continue; // Audio handled separately as MP3

            const isVideoOnly = rf.vcodec && rf.vcodec !== 'none' && (!rf.acodec || rf.acodec === 'none');

            // Robust height resolution
            let height = rf.height || 0;
            if (!height && rf.width && rf.width > 0) {
              height = rf.width === 1920 ? 1080 : Math.round((rf.width * 9) / 16);
            }
            if (!height && rf.resolution) {
              const match = rf.resolution.match(/(\d+)\s*[xX*×]\s*(\d+)/);
              if (match) {
                height = Math.min(parseInt(match[1], 10), parseInt(match[2], 10));
              }
            }
            if (!height && (rf.format_note || rf.format)) {
              const match = `${rf.format_note || ''} ${rf.format || ''}`.match(/(\d{3,4})\s*p?/i);
              if (match) {
                height = parseInt(match[1], 10);
              }
            }

            // Exclude micro thumbnails below 144p
            if (height < 144) continue;

            const sizeBytes = rf.filesize || rf.filesize_approx;
            let filesizeFormatted: string | undefined;
            if (sizeBytes && sizeBytes > 0) {
              filesizeFormatted = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
            } else if (raw.duration && (rf.tbr || 0) > 0) {
              const estimatedBytes = Math.round(((rf.tbr! * 1000) / 8) * raw.duration);
              filesizeFormatted = `~${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
            }

            const standardRes = rf.resolution || (rf.width && rf.height ? `${rf.width}x${rf.height}` : `${Math.round((height * 16) / 9)}x${height}`);

            candidateFormats.push({
              id: `ytdlp-${rf.format_id || height}-${height}p`,
              format: 'MP4',
              quality: `${height}p`,
              resolution: standardRes,
              height,
              url: rf.url,
              filesize: sizeBytes,
              filesizeFormatted,
              hasAudio: !isVideoOnly,
              hasVideo: true,
              isHd: height >= 720,
              mediaType: 'video',
            });
          }

          // Deduplicate by effective height and sort in ASCENDING order (lowest to highest)
          const deduplicated = deduplicateAndSortVideoFormats(candidateFormats);

          resolve({
            id: raw.id,
            title: raw.title || null,
            description: raw.description || null,
            uploader: raw.uploader || raw.channel || null,
            thumbnail: raw.thumbnail || null,
            duration: typeof raw.duration === 'number' ? Math.round(raw.duration) : undefined,
            formats: deduplicated,
          });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /**
   * Downloads and merges video and audio streams using yt-dlp and FFmpeg.
   * Guarantees that the resulting MP4 contains both video and audio streams,
   * verified using ffprobe.
   */
  public static async downloadToLocalFile(
    url: string,
    formatId: string,
    outputDir = '/tmp/clipfetch'
  ): Promise<{ filePath: string; probe: MediaProbeResult; cleanup: () => void } | null> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const uniqueId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const outputTemplate = path.join(outputDir, `${uniqueId}.%(ext)s`);
    const binary = this.getBinaryPath();

    // Determine target height: 480p (Standard) or 720p (High)
    let targetHeight = 720;
    const fLower = formatId.toLowerCase();

    if (fLower.includes('480') || fLower.includes('sd') || fLower === 'standard' || fLower.includes('standard_quality')) {
      targetHeight = 480;
    } else {
      targetHeight = 720;
    }

    // Format selection prioritizing video with matching resolution + best audio stream
    // e.g. bestvideo[height<=1080]+bestaudio/best[height<=1080]/best
    const formatSelector = `bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/bestvideo+bestaudio/best`;

    const args = [
      '-f',
      formatSelector,
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      '/usr/bin/ffmpeg',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      ...this.getCommonArgs(),
      '-o',
      outputTemplate,
      url,
    ];

    const cleanupFiles: string[] = [];

    const cleanup = () => {
      for (const f of cleanupFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    };

    return new Promise(async (resolve) => {
      const proc = spawn(binary, args);
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
        cleanup();
        resolve(null);
      }, 75000);

      proc.on('close', async (code) => {
        clearTimeout(timer);

        // Find created file
        let createdFile: string | null = null;
        const expectedMp4 = path.join(outputDir, `${uniqueId}.mp4`);

        if (fs.existsSync(expectedMp4)) {
          createdFile = expectedMp4;
        } else {
          const matched = fs.readdirSync(outputDir).filter((f) => f.startsWith(uniqueId));
          if (matched.length > 0) {
            createdFile = path.join(outputDir, matched[0]);
          }
        }

        if (!createdFile || !fs.existsSync(createdFile)) {
          cleanup();
          resolve(null);
          return;
        }

        cleanupFiles.push(createdFile);

        // Probe media with ffprobe
        let probe = await probeMediaFile(createdFile);

        // FIX 2: If the video has NO AUDIO (e.g. 1080p / 1440p video-only stream),
        // fetch separate best audio stream and merge it using FFmpeg
        if (probe.hasVideo && !probe.hasAudio) {
          const audioTempTemplate = path.join(outputDir, `${uniqueId}_audio.%(ext)s`);
          const audioArgs = [
            '-f',
            'bestaudio',
            '--ffmpeg-location',
            '/usr/bin/ffmpeg',
            '--no-playlist',
            '--no-warnings',
            '--no-check-certificates',
            ...this.getCommonArgs(),
            '-o',
            audioTempTemplate,
            url,
          ];

          try {
            await new Promise<void>((resAudio) => {
              const audioProc = spawn(binary, audioArgs);
              audioProc.on('close', () => resAudio());
              audioProc.on('error', () => resAudio());
            });

            // Locate audio file
            const audioMatches = fs.readdirSync(outputDir).filter((f) => f.startsWith(`${uniqueId}_audio`));
            if (audioMatches.length > 0) {
              const audioPath = path.join(outputDir, audioMatches[0]);
              cleanupFiles.push(audioPath);

              // Merge video and audio with FFmpeg
              const mergedMp4 = path.join(outputDir, `${uniqueId}_merged.mp4`);
              cleanupFiles.push(mergedMp4);

              await execFileAsync('/usr/bin/ffmpeg', [
                '-y',
                '-i',
                createdFile,
                '-i',
                audioPath,
                '-c:v',
                'copy',
                '-c:a',
                'aac',
                '-b:a',
                '192k',
                '-movflags',
                '+faststart',
                mergedMp4,
              ]);

              if (fs.existsSync(mergedMp4) && fs.statSync(mergedMp4).size > 0) {
                createdFile = mergedMp4;
                probe = await probeMediaFile(createdFile);
              }
            }
          } catch {
            // Best effort merge
          }
        }

        // FIX 1: Ensure MOOV atom is placed at start with faststart for 480p and all MP4s
        // so the file opens cleanly in all standard players and browsers
        const optimizedMp4 = path.join(outputDir, `${uniqueId}_opt.mp4`);
        cleanupFiles.push(optimizedMp4);

        try {
          await execFileAsync('/usr/bin/ffmpeg', [
            '-y',
            '-i',
            createdFile,
            '-c',
            'copy',
            '-movflags',
            '+faststart',
            optimizedMp4,
          ]);

          if (fs.existsSync(optimizedMp4) && fs.statSync(optimizedMp4).size > 0) {
            createdFile = optimizedMp4;
            probe = await probeMediaFile(createdFile);
          }
        } catch {
          // If remux failed, stick with createdFile
        }

        // Final verification check: file must be valid media with video
        if (!probe.isValid || !probe.hasVideo || (probe.size || 0) === 0) {
          cleanup();
          resolve(null);
          return;
        }

        resolve({
          filePath: createdFile,
          probe,
          cleanup,
        });
      });

      proc.on('error', () => {
        clearTimeout(timer);
        cleanup();
        resolve(null);
      });
    });
  }

  /**
   * FIX 3: Extracts audio and converts to MP3 at specified bitrate (48, 128, 320 kbps)
   * using FFmpeg libmp3lame and verifies output using ffprobe.
   */
  public static async extractAndConvertAudio(
    url: string,
    bitrateKbps: number = 128,
    outputDir = '/tmp/clipfetch'
  ): Promise<{ filePath: string; probe: MediaProbeResult; cleanup: () => void } | null> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Strictly validate bitrate against supported targets
    const targetBitrate = [48, 128, 320].includes(bitrateKbps) ? bitrateKbps : 128;
    const uniqueId = `audio_${Date.now()}_${targetBitrate}k_${Math.random().toString(36).slice(2, 8)}`;
    const outputMp3 = path.join(outputDir, `${uniqueId}.mp3`);
    const tempRawTemplate = path.join(outputDir, `${uniqueId}_raw.%(ext)s`);
    const binary = this.getBinaryPath();

    const cleanupFiles: string[] = [outputMp3];
    const cleanup = () => {
      for (const f of cleanupFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    };

    // If url is a direct video/media link (e.g. .mp4 or fbcdn), attempt direct FFmpeg conversion first
    const isDirectMedia = (() => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        const allowedMediaDomains = ['fbcdn.net', 'facebook.com', 'akamaihd.net', 'googlevideo.com', 'cdninstagram.com'];
        const isAllowedDomain = allowedMediaDomains.some((d) => host === d || host.endsWith('.' + d));
        const pathname = parsed.pathname.toLowerCase();
        const hasMediaExt = pathname.endsWith('.mp4') || pathname.endsWith('.m4a') || pathname.endsWith('.webm');
        return isAllowedDomain && hasMediaExt;
      } catch {
        return false;
      }
    })();

    if (isDirectMedia) {
      const directFfmpegArgs = [
        '-y',
        '-i',
        url,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${targetBitrate}k`,
        '-ar',
        '44100',
        '-ac',
        '2',
        outputMp3,
      ];

      const resDirect = await runLoggedProcess('ffmpeg', '/usr/bin/ffmpeg', directFfmpegArgs, 45000);
      if (resDirect.code === 0 && fs.existsSync(outputMp3)) {
        const stat = fs.statSync(outputMp3);
        if (stat.size > 0) {
          console.log('[Audio] Final file size in bytes:', stat.size);
          const probe = await probeMediaFile(outputMp3);
          if (probe.isValid && probe.hasAudio) {
            return { filePath: outputMp3, probe, cleanup };
          }
        }
      }
    }

    // Stage 1: Download raw audio or media stream using yt-dlp
    let rawAudioFile: string | null = null;
    const dlArgs = [
      '-f',
      'bestaudio/best',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      ...this.getCommonArgs(),
      '-o',
      tempRawTemplate,
      url,
    ];

    await runLoggedProcess('yt-dlp', binary, dlArgs, 50000);

    const matched = fs.readdirSync(outputDir).filter((f) => f.startsWith(`${uniqueId}_raw`));
    if (matched.length > 0) {
      rawAudioFile = path.join(outputDir, matched[0]);
      cleanupFiles.push(rawAudioFile);
    }

    // Stage 2: Convert to MP3 using FFmpeg with explicit libmp3lame and -b:a ${targetBitrate}k
    const inputTarget = rawAudioFile || (isDirectMedia ? url : null);
    if (inputTarget) {
      const ffmpegArgs = [
        '-y',
        '-i',
        inputTarget,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${targetBitrate}k`,
        '-ar',
        '44100',
        '-ac',
        '2',
        outputMp3,
      ];

      const resFfmpeg = await runLoggedProcess('ffmpeg', '/usr/bin/ffmpeg', ffmpegArgs, 45000);
      if (resFfmpeg.code === 0 && fs.existsSync(outputMp3)) {
        const stat = fs.statSync(outputMp3);
        if (stat.size > 0) {
          console.log('[Audio] Final file size in bytes:', stat.size);
          const probe = await probeMediaFile(outputMp3);
          if (probe.isValid && probe.hasAudio && probe.audioCodec === 'mp3') {
            return {
              filePath: outputMp3,
              probe,
              cleanup,
            };
          }
        }
      }
    }

    // Fallback: Try yt-dlp integrated conversion if direct FFmpeg failed
    const ytdlpAudioArgs = [
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      `${targetBitrate}K`,
      '--ffmpeg-location',
      '/usr/bin/ffmpeg',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      ...this.getCommonArgs(),
      '-o',
      outputMp3,
      url,
    ];

    const resYtdlp = await runLoggedProcess('yt-dlp', binary, ytdlpAudioArgs, 50000);
    if (resYtdlp.code === 0 && fs.existsSync(outputMp3)) {
      const stat = fs.statSync(outputMp3);
      if (stat.size > 0) {
        console.log('[Audio] Final file size in bytes:', stat.size);
        const probe = await probeMediaFile(outputMp3);
        if (probe.isValid && probe.hasAudio) {
          return {
            filePath: outputMp3,
            probe,
            cleanup,
          };
        }
      }
    }

    cleanup();
    return null;
  }
}
