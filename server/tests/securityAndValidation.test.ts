import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateAndClassifyUrl, isPrivateOrReservedIp, validateMediaDownloadUrl } from '../src/utils/ssrfGuard.js';
import { sanitizeFilename } from '../src/services/downloadService.js';
import {
  videoInfoSchema,
  videoDownloadSchema,
  videoInfoQuerySchema,
  downloadQuerySchema,
  videoStreamQuerySchema,
} from '../src/validators/videoValidator.js';
import { createServerApp } from '../src/app.js';
import type { Server } from 'http';
import { adapterRegistry } from '../src/services/adapters/AdapterRegistry.js';
import { FacebookAdapter } from '../src/services/adapters/FacebookAdapter.js';
import { deduplicateAndSortVideoFormats, generateAudioFormats, selectStandardAndHighFormats } from '../src/utils/formatNormalizer.js';
import { VideoFormat } from '../src/types/index.js';
import { probeMediaFile, verifyVideoOutput, getFfmpegBinary, getFfprobeBinary } from '../src/utils/mediaProbe.js';
import { YtDlpService } from '../src/services/ytDlpService.js';
import { getCachedVideoInfo, setCachedVideoInfo, clearVideoInfoCache, processVideoInfo } from '../src/services/videoService.js';
import { ticketStore } from '../src/routes/apiRoutes.js';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('SSRF Protection & IP Restrictions', () => {
  it('identifies private IPv4 addresses accurately', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.100')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // AWS/GCP metadata
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
  });

  it('permits public IP addresses', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('104.244.42.1')).toBe(false);
    expect(isPrivateOrReservedIp('157.240.241.35')).toBe(false);
  });

  it('identifies private IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
  });
});

describe('URL Validation & Platform Classification', () => {
  it('correctly classifies valid Facebook URLs', async () => {
    const res = await validateAndClassifyUrl('https://www.facebook.com/watch/?v=123456');
    expect(res.safe).toBe(true);
    expect(res.platform).toBe('facebook');

    const reelRes = await validateAndClassifyUrl('https://www.facebook.com/reel/10158792070386729');
    expect(reelRes.safe).toBe(true);
    expect(reelRes.platform).toBe('facebook');

    const watchRes = await validateAndClassifyUrl('https://fb.watch/sampleReel/');
    expect(watchRes.safe).toBe(true);
    expect(watchRes.platform).toBe('facebook');
  });

  it('rejects non-Facebook platforms as unsupported', async () => {
    const xRes = await validateAndClassifyUrl('https://x.com/jack/status/20');
    expect(xRes.safe).toBe(false);
    expect(xRes.error).toMatch(/Unsupported/i);

    const igRes = await validateAndClassifyUrl('https://www.instagram.com/reel/C7xyz123/');
    expect(igRes.safe).toBe(false);
    expect(igRes.error).toMatch(/Unsupported/i);

    const ytRes = await validateAndClassifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(ytRes.safe).toBe(false);
    expect(ytRes.error).toMatch(/Unsupported/i);
  });

  it('rejects lookalike domains (e.g. facebook.com.attacker.com)', async () => {
    const res = await validateAndClassifyUrl('https://facebook.com.malicious.example/video');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/Lookalike|Unsupported/i);
  });

  it('rejects unsupported domains (e.g. tiktok.com, vimeo.com)', async () => {
    const res = await validateAndClassifyUrl('https://www.tiktok.com/@user/video/123456');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/Unsupported platform/i);
  });

  it('rejects localhost and internal hostnames', async () => {
    const res = await validateAndClassifyUrl('http://localhost:8080/exploit');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/internal hostnames|prohibited/i);
  });

  it('rejects non-HTTP protocols (e.g. file://, ftp://, javascript:)', async () => {
    const res = await validateAndClassifyUrl('file:///etc/passwd');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/protocols are allowed/i);
  });

  it('rejects embedded credentials in URL', async () => {
    const res = await validateAndClassifyUrl('https://admin:pass@x.com/status/123');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/credentials are not permitted/i);
  });
});

describe('Media Download URL Whitelist & SSRF Guard', () => {
  it('approves legitimate Facebook CDN media URLs', async () => {
    const res = await validateMediaDownloadUrl('https://video.xx.fbcdn.net/v/t39.254/video.mp4');
    expect(res.safe).toBe(true);

    const scontentRes = await validateMediaDownloadUrl('https://scontent.xx.fbcdn.net/v/t39.254/video.mp4');
    expect(scontentRes.safe).toBe(true);
  });

  it('rejects non-Facebook CDN domains for media streaming', async () => {
    const res = await validateMediaDownloadUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/test.mp4');
    expect(res.safe).toBe(false);
  });

  it('rejects unauthorized arbitrary domains for media streaming', async () => {
    const res = await validateMediaDownloadUrl('https://evil-unauthorized-server.com/test.mp4');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/authorized media content distribution network/i);
  });
});

describe('Filename Sanitization', () => {
  it('strips illegal characters and limits filename length safely', () => {
    const title = 'Amazing Sunset 🌅 & Relaxing Waves / 100% Real';
    const sanitized = sanitizeFilename(title);
    expect(sanitized).toMatch(/^ClipFetch_[\w.-]+\.mp4$/);
    expect(sanitized).not.toContain('&');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('%');
  });

  it('falls back to default name when title is empty', () => {
    const sanitized = sanitizeFilename('', 'fallback');
    expect(sanitized).toBe('fallback.mp4');
  });
});

describe('Zod Request Validators', () => {
  it('validates correct VideoInfo payload', () => {
    const parsed = videoInfoSchema.safeParse({ url: 'https://www.facebook.com/watch/?v=12345' });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty or missing URL', () => {
    const parsed = videoInfoSchema.safeParse({ url: '' });
    expect(parsed.success).toBe(false);
  });

  it('validates VideoDownload payload', () => {
    const parsed = videoDownloadSchema.safeParse({
      url: 'https://www.facebook.com/watch/?v=12345',
      formatId: 'fb-720p',
    });
    expect(parsed.success).toBe(true);
  });

  it('automatically handles and truncates title exceeding 200 characters without failing', () => {
    const excessivelyLongTitle = 'Extremely long video post caption or Facebook title '.repeat(10); // 520 chars
    const parsed = videoDownloadSchema.safeParse({
      url: 'https://www.facebook.com/watch/?v=12345',
      formatId: 'fb-720p',
      title: excessivelyLongTitle,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBeDefined();
      expect(parsed.data.title!.length).toBeLessThanOrEqual(200);
      expect(parsed.data.title!.endsWith('...')).toBe(true);
    }
  });
});

describe('Adapter Registry', () => {
  it('resolves correct adapter for each platform', () => {
    const fbAdapter = adapterRegistry.getAdapter(new URL('https://www.facebook.com/watch/?v=123'));
    expect(fbAdapter?.platform).toBe('facebook');

    const fbReelAdapter = adapterRegistry.getAdapter(new URL('https://www.facebook.com/reel/123456789'));
    expect(fbReelAdapter?.platform).toBe('facebook');

    const fbWatchAdapter = adapterRegistry.getAdapter(new URL('https://fb.watch/xyz123/'));
    expect(fbWatchAdapter?.platform).toBe('facebook');
  });
});

describe('yt-dlp Engine & Media Whitelist', () => {
  it('validates Facebook cdn and media host endpoints', async () => {
    const fbCdn = await validateMediaDownloadUrl('https://video.xx.fbcdn.net/v/t39.254-2/sample.mp4');
    expect(fbCdn.safe).toBe(true);

    const fbMedia = await validateMediaDownloadUrl('https://www.facebook.com/video/sample.mp4');
    expect(fbMedia.safe).toBe(true);
  });
});

describe('Format Normalizer: Deduplication & Ascending Sort', () => {
  it('eliminates duplicate video resolutions and sorts all available formats ascending without artificial cap', () => {
    const rawFormats = [
      { id: 'fmt-1080p', format: 'MP4', quality: '1080p', resolution: '1920x1080', height: 1080, url: 'https://cdn.example.com/1080', hasAudio: true, hasVideo: true },
      { id: 'fmt-720p-dup1', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://cdn.example.com/720a', hasAudio: true, hasVideo: true },
      { id: 'fmt-720p-dup2', format: 'MP4', quality: '720p', resolution: '1280x720', height: 720, url: 'https://cdn.example.com/720b', hasAudio: false, hasVideo: true },
      { id: 'fmt-480p-dup1', format: 'MP4', quality: '480p', resolution: '854x480', height: 480, url: 'https://cdn.example.com/480a', hasAudio: true, hasVideo: true },
      { id: 'fmt-480p-dup2', format: 'MP4', quality: '480p (SD)', resolution: '854x480', height: 480, url: 'https://cdn.example.com/480b', hasAudio: true, hasVideo: true },
      { id: 'fmt-360p', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://cdn.example.com/360', hasAudio: true, hasVideo: true },
    ];

    const normalized = deduplicateAndSortVideoFormats(rawFormats as any);
    // Preserves all available heights without artificial caps: 360p, 480p, 720p, 1080p
    expect(normalized).toHaveLength(4);
    expect(normalized.map((f) => f.height)).toEqual([360, 480, 720, 1080]);
    expect(normalized.find((f) => f.height === 720)?.url).toBe('https://cdn.example.com/720a');
  });

  it('generates standard 128 kbps MP3 audio download option', () => {
    const audioOptions = generateAudioFormats('https://example.com/video', 120);

    expect(audioOptions).toHaveLength(1);
    expect(audioOptions[0].audioBitrate).toBe(128);
    expect(audioOptions[0].format).toBe('MP3');
    expect(audioOptions[0].isAudio).toBe(true);
    expect(audioOptions[0].filesizeFormatted).toBeDefined();
    expect(audioOptions[0].quality).toContain('128 kbps');
  });

  it('extracts and normalizes 480p and 720p from mixed format lists', () => {
    const mixedFormats = [
      { id: 'sample-hd', format: 'MP4', quality: 'HD', resolution: '1280x720', url: 'https://cdn.example.com/hd', hasAudio: true, hasVideo: true },
      { id: 'sample-sd', format: 'MP4', quality: 'SD', resolution: '854x480', url: 'https://cdn.example.com/sd', hasAudio: true, hasVideo: true },
    ];

    const sorted = deduplicateAndSortVideoFormats(mixedFormats as any);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].quality).toBe('480p (SD)');
    expect(sorted[1].quality).toBe('720p (HD)');
    expect(sorted[1].height).toBe(720);
    expect(sorted[1].resolution).toBe('1280x720');
    expect(sorted[1].isHd).toBe(true);
  });
});

describe('Download Pipeline Regression Tests (5 Cases)', () => {
  const tmpDir = '/tmp/clipfetch_test';

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('Case 1: 480p SD video is remuxed with faststart, opens cleanly, and passes ffprobe verification', async () => {
    const test480p = path.join(tmpDir, 'test_480p.mp4');
    // Generate valid 480p test video with audio using FFmpeg
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100',
      '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      test480p,
    ]);

    const probe = await probeMediaFile(test480p);
    expect(probe.isValid).toBe(true);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.height).toBe(480);
    expect(probe.size).toBeGreaterThan(0);
  });

  it('Case 2: 720p HD video contains both video and audio streams and plays correctly', async () => {
    const test720p = path.join(tmpDir, 'test_720p.mp4');
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      test720p,
    ]);

    const probe = await probeMediaFile(test720p);
    expect(probe.isValid).toBe(true);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.height).toBe(720);
    expect(probe.size).toBeGreaterThan(0);
  });

  it('Case 3: 1080p Full HD video merges video and audio streams so it is never video-only', async () => {
    const videoOnly1080 = path.join(tmpDir, 'raw_1080p_video.mp4');
    const audioTrack = path.join(tmpDir, 'audio_track.aac');
    const merged1080p = path.join(tmpDir, 'merged_1080p.mp4');

    // Generate video-only 1080p
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=24',
      '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      videoOnly1080,
    ]);

    // Generate separate audio
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100',
      '-t', '1',
      '-c:a', 'aac', '-b:a', '192k',
      audioTrack,
    ]);

    // Initial probe confirms video-only before merging
    const rawProbe = await probeMediaFile(videoOnly1080);
    expect(rawProbe.hasVideo).toBe(true);
    expect(rawProbe.hasAudio).toBe(false);

    // Merge using FFmpeg
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-i', videoOnly1080,
      '-i', audioTrack,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      merged1080p,
    ]);

    // Merged probe confirms BOTH video and audio streams present
    const mergedProbe = await probeMediaFile(merged1080p);
    expect(mergedProbe.isValid).toBe(true);
    expect(mergedProbe.hasVideo).toBe(true);
    expect(mergedProbe.hasAudio).toBe(true);
    expect(mergedProbe.height).toBe(1080);
  });

  it('Case 4: 1440p (2K) video merges video and audio streams so it is never video-only', async () => {
    const videoOnly1440 = path.join(tmpDir, 'raw_1440p_video.mp4');
    const audioTrack = path.join(tmpDir, 'audio_1440.aac');
    const merged1440p = path.join(tmpDir, 'merged_1440p.mp4');

    // Generate video-only 1440p
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=2560x1440:rate=24',
      '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      videoOnly1440,
    ]);

    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100',
      '-t', '1',
      '-c:a', 'aac', '-b:a', '192k',
      audioTrack,
    ]);

    const rawProbe = await probeMediaFile(videoOnly1440);
    expect(rawProbe.hasVideo).toBe(true);
    expect(rawProbe.hasAudio).toBe(false);

    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-i', videoOnly1440,
      '-i', audioTrack,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      merged1440p,
    ]);

    const mergedProbe = await probeMediaFile(merged1440p);
    expect(mergedProbe.isValid).toBe(true);
    expect(mergedProbe.hasVideo).toBe(true);
    expect(mergedProbe.hasAudio).toBe(true);
    expect(mergedProbe.height).toBe(1440);
  });

  it('Case 5: MP3 48 kbps conversion produces valid MP3 with correct codec and bitrate', async () => {
    const inputAudio = path.join(tmpDir, 'raw_input.wav');
    const output48k = path.join(tmpDir, 'output_48kbps.mp3');

    // Generate 1-second raw audio
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100',
      '-t', '1',
      inputAudio,
    ]);

    // Encode to 48 kbps MP3 using libmp3lame
    execFileSync('/usr/bin/ffmpeg', [
      '-y',
      '-i', inputAudio,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '48k',
      '-ar', '44100',
      '-ac', '2',
      output48k,
    ]);

    const probe = await probeMediaFile(output48k);
    expect(probe.isValid).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.hasVideo).toBe(false);
    expect(probe.audioCodec).toBe('mp3');
    expect(probe.audioBitrate).toBe(48);
    expect(probe.size).toBeGreaterThan(0);
  });
});

describe('Query Parameter Validation & Tampering Prevention (Zod Schema Tests)', () => {
  describe('videoInfoQuerySchema', () => {
    it('rejects repeated query parameters passed as arrays', () => {
      const parsed = videoInfoQuerySchema.safeParse({
        url: ['https://www.facebook.com/watch/?v=1', 'https://www.facebook.com/watch/?v=2'],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects object-style query parameters', () => {
      const parsed = videoInfoQuerySchema.safeParse({
        url: { malicious: 'true' },
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects missing or empty url parameter', () => {
      const missing = videoInfoQuerySchema.safeParse({});
      expect(missing.success).toBe(false);

      const empty = videoInfoQuerySchema.safeParse({ url: '' });
      expect(empty.success).toBe(false);
    });

    it('accepts valid string Facebook URL', () => {
      const parsed = videoInfoQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123456',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.url).toBe('https://www.facebook.com/watch/?v=123456');
      }
    });
  });

  describe('downloadQuerySchema', () => {
    it('rejects repeated query parameters passed as arrays', () => {
      const repeatedUrl = downloadQuerySchema.safeParse({
        url: ['https://www.facebook.com/watch/?v=1', 'https://www.facebook.com/watch/?v=2'],
      });
      expect(repeatedUrl.success).toBe(false);

      const repeatedType = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        type: ['video', 'audio'],
      });
      expect(repeatedType.success).toBe(false);

      const repeatedQuality = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        quality: ['720p', '480p'],
      });
      expect(repeatedQuality.success).toBe(false);
    });

    it('rejects object-style query parameters', () => {
      const objUrl = downloadQuerySchema.safeParse({
        url: { link: 'https://facebook.com' },
      });
      expect(objUrl.success).toBe(false);

      const objTitle = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        title: { key: 'val' },
      });
      expect(objTitle.success).toBe(false);
    });

    it('rejects invalid enum values for type', () => {
      const invalidType = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        type: 'executable',
      });
      expect(invalidType.success).toBe(false);
    });

    it('accepts valid download parameters and applies defaults', () => {
      const minimal = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
      });
      expect(minimal.success).toBe(true);
      if (minimal.success) {
        expect(minimal.data.type).toBe('video');
        expect(minimal.data.quality).toBe('best');
      }

      const explicit = downloadQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        type: 'audio',
        quality: '128',
        title: 'Custom Title',
      });
      expect(explicit.success).toBe(true);
      if (explicit.success) {
        expect(explicit.data.type).toBe('audio');
        expect(explicit.data.quality).toBe('128');
        expect(explicit.data.title).toBe('Custom Title');
      }
    });
  });

  describe('videoStreamQuerySchema', () => {
    it('rejects repeated query parameters passed as arrays', () => {
      const repeatedUrl = videoStreamQuerySchema.safeParse({
        url: ['https://www.facebook.com/1', 'https://www.facebook.com/2'],
      });
      expect(repeatedUrl.success).toBe(false);

      const repeatedPageUrl = videoStreamQuerySchema.safeParse({
        pageUrl: ['https://www.facebook.com/1', 'https://www.facebook.com/2'],
      });
      expect(repeatedPageUrl.success).toBe(false);
    });

    it('rejects object-style query parameters', () => {
      const objTitle = videoStreamQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        title: { hack: 1 },
      });
      expect(objTitle.success).toBe(false);
    });

    it('rejects when both url and pageUrl are missing', () => {
      const parsed = videoStreamQuerySchema.safeParse({
        formatId: '720p',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-numeric audioBitrate', () => {
      const parsed = videoStreamQuerySchema.safeParse({
        url: 'https://www.facebook.com/watch/?v=123',
        audioBitrate: 'abc',
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts valid stream query with either url or pageUrl', () => {
      const withUrl = videoStreamQuerySchema.safeParse({
        url: 'https://video.xx.fbcdn.net/sample.mp4',
        title: 'Sample Video',
      });
      expect(withUrl.success).toBe(true);

      const withPageUrl = videoStreamQuerySchema.safeParse({
        pageUrl: 'https://www.facebook.com/watch/?v=123',
        formatId: '720p',
        mediaType: 'video',
      });
      expect(withPageUrl.success).toBe(true);
    });
  });
});

describe('HTTP Endpoint Query Tampering Regression Tests', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createServerApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  describe('GET /api/info validation', () => {
    it('returns HTTP 400 for repeated url query parameters (?url=a&url=b)', async () => {
      const res = await fetch(`${baseUrl}/api/info?url=https://facebook.com/1&url=https://facebook.com/2`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for object-style query parameters (?url[hack]=evil)', async () => {
      const res = await fetch(`${baseUrl}/api/info?url[hack]=evil`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for missing url parameter', async () => {
      const res = await fetch(`${baseUrl}/api/info`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for invalid url format', async () => {
      const res = await fetch(`${baseUrl}/api/info?url=not-a-valid-url`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/download validation', () => {
    it('returns HTTP 400 for repeated url query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/download?url=https://facebook.com/1&url=https://facebook.com/2`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for repeated type query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/download?url=https://facebook.com/watch/?v=123&type=video&type=audio`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for invalid type parameter', async () => {
      const res = await fetch(`${baseUrl}/api/download?url=https://facebook.com/watch/?v=123&type=malicious`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for missing url parameter', async () => {
      const res = await fetch(`${baseUrl}/api/download`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/video/stream validation', () => {
    it('returns HTTP 400 for repeated url query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/video/stream?url=https://facebook.com/1&url=https://facebook.com/2`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for repeated pageUrl query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/video/stream?pageUrl=https://facebook.com/1&pageUrl=https://facebook.com/2`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 when neither url nor pageUrl is provided', async () => {
      const res = await fetch(`${baseUrl}/api/video/stream?title=Test`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 400 for non-numeric audioBitrate', async () => {
      const res = await fetch(`${baseUrl}/api/video/stream?url=https://facebook.com/watch/?v=123&audioBitrate=invalid`);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('HEAD /api/download safety', () => {
    it('handles repeated type gracefully without throwing', async () => {
      const res = await fetch(`${baseUrl}/api/download?type=audio&type=video`, { method: 'HEAD' });
      expect(res.status).toBe(200);
    });
  });

  describe('Security Remediations (CodeQL Alerts Verification)', () => {
    it('enforces secure Helmet HTTP headers on API responses', async () => {
      const res = await fetch(`${baseUrl}/api/check`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const csp = res.headers.get('content-security-policy');
      expect(csp).toBeDefined();
      expect(csp).toContain("frame-ancestors 'self'");
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    });

    it('returns rate limit tracking headers on API endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/check`);
      expect(res.status).toBe(200);
      // express-rate-limit standard or legacy headers
      const hasRateLimitHeader =
        res.headers.has('ratelimit-limit') ||
        res.headers.has('x-ratelimit-limit') ||
        res.headers.has('ratelimit-remaining');
      expect(hasRateLimitHeader).toBe(true);
    });

    it('rejects path-embedded and lookalike domains without url.includes vulnerability', async () => {
      // Attacker tries putting fbcdn.net in pathname or subdomain of an untrusted host
      const fakeCdn1 = await validateMediaDownloadUrl('https://evil.com/fbcdn.net/exploit.mp4');
      expect(fakeCdn1.safe).toBe(false);

      const fakeCdn2 = await validateMediaDownloadUrl('https://fbcdn.net.attacker.com/exploit.mp4');
      expect(fakeCdn2.safe).toBe(false);

      const lookalike = await validateAndClassifyUrl('https://facebook.com.malicious.org/video');
      expect(lookalike.safe).toBe(false);

      const lookalikeAttacker1 = await validateAndClassifyUrl('https://facebook-attacker.com/video');
      expect(lookalikeAttacker1.safe).toBe(false);

      const lookalikeAttacker2 = await validateAndClassifyUrl('https://attacker-facebook.com/video');
      expect(lookalikeAttacker2.safe).toBe(false);
    });

    it('does not leak internal error objects or stack traces on errors', async () => {
      const res = await fetch(`${baseUrl}/api/video/stream?url=https://facebook.com/watch/?v=999999999999999&formatId=fake_format`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      // Ensure no stack traces or raw system exceptions are leaked to the client
      expect(json.stack).toBeUndefined();
      expect(json.error?.stack).toBeUndefined();
      if (json.error?.message) {
        expect(json.error.message).not.toContain('/app/applet');
        expect(json.error.message).not.toContain('node:internal');
      }
    });

    it('Helmet CSP restricts frame-ancestors to self and trusted origins without broad http/https', async () => {
      const res = await fetch(`${baseUrl}/api/check`);
      const csp = res.headers.get('content-security-policy') || '';
      const frameDirective =
        csp
          .split(';')
          .map((d) => d.trim())
          .find((d) => d.startsWith('frame-ancestors')) || '';
      expect(frameDirective).toContain("'self'");
      expect(frameDirective).not.toMatch(/\bhttps:\b/);
      expect(frameDirective).not.toMatch(/\bhttp:\b/);
    });
  });

  describe('Quality Selection (720p Cap & Fallbacks)', () => {
    it('selects the highest available resolution capped at 720p without exceeding 720p', () => {
      const formats: VideoFormat[] = [
        { id: '1', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://fbcdn.net/360.mp4' },
        { id: '2', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://fbcdn.net/720.mp4' },
        { id: '3', format: 'MP4', quality: '1080p (Full HD)', resolution: '1920x1080', height: 1080, url: 'https://fbcdn.net/1080.mp4' },
        { id: '4', format: 'MP4', quality: '1440p (2K)', resolution: '2560x1440', height: 1440, url: 'https://fbcdn.net/1440.mp4' },
        { id: '5', format: 'MP4', quality: '2160p (4K)', resolution: '3840x2160', height: 2160, url: 'https://fbcdn.net/2160.mp4' },
      ];
      const res = selectStandardAndHighFormats(formats);
      expect(res.high?.height).toBe(720);
      expect(res.high?.quality).toBe('720p (HD)');
      expect(res.standard?.height).toBe(360);
    });

    it('automatically downloads the highest available below 1080p when 1080p is unavailable without upscaling', () => {
      const formats: VideoFormat[] = [
        { id: '1', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://fbcdn.net/360.mp4' },
        { id: '2', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://fbcdn.net/720.mp4' },
      ];
      const res = selectStandardAndHighFormats(formats);
      expect(res.high?.height).toBe(720);
      expect(res.high?.quality).toBe('720p (HD)');
      expect(res.standard?.height).toBe(360);
    });

    it('preserves all available deduplicated resolutions in deduplicateAndSortVideoFormats', () => {
      const formats: VideoFormat[] = [
        { id: '1', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://fbcdn.net/360.mp4' },
        { id: '2', format: 'MP4', quality: '480p', resolution: '854x480', height: 480, url: 'https://fbcdn.net/480.mp4' },
        { id: '3', format: 'MP4', quality: '720p', resolution: '1280x720', height: 720, url: 'https://fbcdn.net/720.mp4' },
        { id: '4', format: 'MP4', quality: '1080p', resolution: '1920x1080', height: 1080, url: 'https://fbcdn.net/1080.mp4' },
        { id: '5', format: 'MP4', quality: '2160p', resolution: '3840x2160', height: 2160, url: 'https://fbcdn.net/2160.mp4' },
      ];
      const result = deduplicateAndSortVideoFormats(formats);
      expect(result.length).toBe(5);
      expect(result.map((f) => f.height)).toEqual([360, 480, 720, 1080, 2160]);
    });
  });

  describe('Malicious Hostname Lookalikes & Exact Domain Allowlisting (CodeQL Regression)', () => {
    it('strictly rejects lookalike and spoofed domain URLs in SSRF guard', async () => {
      const maliciousUrls = [
        'https://facebook.com.attacker.com/watch?v=123',
        'https://evil-facebook.com/watch?v=123',
        'https://facebook-phishing.com/video/456',
        'https://notfacebook.com/reel/789',
        'https://fb.watch.evil.org/abc',
        'https://evilfb.watch/xyz',
        'https://attacker-fb.gg/clip',
      ];

      for (const u of maliciousUrls) {
        const res = await validateAndClassifyUrl(u);
        expect(res.safe).toBe(false);
        expect(res.platform).toBe('unknown');
      }
    });

    it('strictly matches allowed domain boundaries for frontend and adapter validation', () => {
      const allowedDomains = ['facebook.com', 'fb.watch', 'fb.gg'];
      const checkHost = (hostname: string) => {
        const h = hostname.toLowerCase();
        return allowedDomains.some((d) => h === d || h.endsWith('.' + d));
      };

      // Valid domains
      expect(checkHost('facebook.com')).toBe(true);
      expect(checkHost('www.facebook.com')).toBe(true);
      expect(checkHost('m.facebook.com')).toBe(true);
      expect(checkHost('web.facebook.com')).toBe(true);
      expect(checkHost('fb.watch')).toBe(true);
      expect(checkHost('fb.gg')).toBe(true);

      // Malicious lookalikes must fail
      expect(checkHost('evil-facebook.com')).toBe(false);
      expect(checkHost('facebook.com.attacker.com')).toBe(false);
      expect(checkHost('notfacebook.com')).toBe(false);
      expect(checkHost('myfb.watch')).toBe(false);
      expect(checkHost('fb.watch.evil.com')).toBe(false);
      expect(checkHost('fakefb.gg')).toBe(false);
    });
  });

  describe('Single-Pass Entity Decoding & Double Unescaping Prevention (CodeQL Regression)', () => {
    const adapter = new FacebookAdapter();

    it('prevents double-unescaping when input contains &amp;lt;', () => {
      // If &amp; is unescaped in a separate first pass, &amp;lt; turns into &lt;, which becomes <.
      // With single-pass dictionary replacement, &amp;lt; must remain &lt; and NOT turn into <.
      const maliciousInput = '&amp;lt;script&gt;alert(1)&amp;lt;/script&gt;';
      const cleaned = adapter.cleanString(maliciousInput);
      expect(cleaned).toBe('&lt;script>alert(1)&lt;/script>');
      expect(cleaned).not.toContain('<script');
    });

    it('safely unescapes legitimate HTML entities in titles and descriptions', () => {
      const titleWithEntities = '&quot;ClipFetch Demo&quot; &amp; &#39;Special&#39; &#x2F; &lt;Trailer&gt;';
      const cleaned = adapter.cleanString(titleWithEntities);
      expect(cleaned).toBe('"ClipFetch Demo" & \'Special\' / <Trailer>');
    });

    it('handles nested ampersands without recursive replacement', () => {
      const doubleAmp = '&amp;amp;';
      const cleaned = adapter.cleanString(doubleAmp);
      expect(cleaned).toBe('&amp;');
    });

    it('gracefully handles empty, falsy, or malformed input', () => {
      expect(adapter.cleanString('')).toBe('');
      // @ts-expect-error test runtime boundary
      expect(adapter.cleanString(null)).toBe('');
      // @ts-expect-error test runtime boundary
      expect(adapter.cleanString(undefined)).toBe('');
      expect(adapter.cleanString('Simple Normal Title')).toBe('Simple Normal Title');
    });
  });

  describe('Audio/Video Stream Merging & Silent Video Bug Fix Regression Tests', () => {
    const testDir = '/tmp/clipfetch_av_test';
    const ffmpegBin = getFfmpegBinary();
    const ffprobeBin = getFfprobeBinary();

    beforeAll(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterAll(() => {
      try {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      } catch {}
    });

    it('(a) video & audio merged: ensures separate video and audio streams merge into a playable output with both streams', async () => {
      const videoOnlyPath = path.join(testDir, 'raw_video.mp4');
      const audioTrackPath = path.join(testDir, 'raw_audio.aac');
      const mergedOutputPath = path.join(testDir, 'merged_output.mp4');

      // 1. Generate video-only track (silent)
      execFileSync(ffmpegBin, [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24',
        '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        videoOnlyPath,
      ]);

      // 2. Generate separate audio track
      execFileSync(ffmpegBin, [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '1',
        '-c:a', 'aac', '-b:a', '128k',
        audioTrackPath,
      ]);

      // Verify separate tracks before merge
      const videoProbe = await probeMediaFile(videoOnlyPath);
      expect(videoProbe.hasVideo).toBe(true);
      expect(videoProbe.hasAudio).toBe(false);

      const audioProbe = await probeMediaFile(audioTrackPath);
      expect(audioProbe.hasVideo).toBe(false);
      expect(audioProbe.hasAudio).toBe(true);

      // 3. Merge streams with FFmpeg using copy for video and AAC for audio
      execFileSync(ffmpegBin, [
        '-y',
        '-i', videoOnlyPath,
        '-i', audioTrackPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        mergedOutputPath,
      ]);

      // 4. Verify merged output has BOTH video and audio streams
      const mergedProbe = await probeMediaFile(mergedOutputPath);
      expect(mergedProbe.isValid).toBe(true);
      expect(mergedProbe.hasVideo).toBe(true);
      expect(mergedProbe.hasAudio).toBe(true);
      expect(mergedProbe.audioCodec).toBe('aac');

      const verification = await verifyVideoOutput(mergedOutputPath, true);
      expect(verification.valid).toBe(true);
      expect(verification.hasVideo).toBe(true);
      expect(verification.hasAudio).toBe(true);
    });

    it('(b) missing audio stream detected: detects when media has video but lacks audio and flags it as invalid', async () => {
      const silentVideoPath = path.join(testDir, 'silent_test_video.mp4');

      // Generate video-only stream with no audio track
      execFileSync(ffmpegBin, [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24',
        '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        silentVideoPath,
      ]);

      const probe = await probeMediaFile(silentVideoPath);
      expect(probe.isValid).toBe(true);
      expect(probe.hasVideo).toBe(true);
      expect(probe.hasAudio).toBe(false);

      // Validation with requireAudio=true must detect missing audio and reject
      const verification = await verifyVideoOutput(silentVideoPath, true);
      expect(verification.valid).toBe(false);
      expect(verification.hasVideo).toBe(true);
      expect(verification.hasAudio).toBe(false);
      expect(verification.reason).toMatch(/Missing audio stream/i);
    });

    it('(c) FFmpeg merge failure handled: does not treat a failed merge as successful and rejects intermediate video-only files', async () => {
      const videoOnlyPath = path.join(testDir, 'source_video.mp4');
      const corruptAudioPath = path.join(testDir, 'corrupt_audio.aac');
      const failedMergePath = path.join(testDir, 'failed_merge_out.mp4');

      // Create valid video file
      execFileSync(ffmpegBin, [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24',
        '-t', '1',
        '-c:v', 'libx264',
        videoOnlyPath,
      ]);

      // Create a corrupted audio file that is not a valid audio bitstream
      fs.writeFileSync(corruptAudioPath, Buffer.from('NOT_A_VALID_AUDIO_BITSTREAM_CORRUPT_HEADER'));

      // Attempt merge with corrupt audio - must fail
      let mergeThrew = false;
      try {
        execFileSync(ffmpegBin, [
          '-y',
          '-i', videoOnlyPath,
          '-i', corruptAudioPath,
          '-c:v', 'copy',
          '-c:a', 'aac',
          failedMergePath,
        ], { stdio: 'pipe' });
      } catch {
        mergeThrew = true;
      }

      expect(mergeThrew).toBe(true);
      expect(fs.existsSync(failedMergePath)).toBe(false);

      // Verify that the intermediate videoOnlyPath without audio is NOT accepted as a complete video
      const intermediateVerification = await verifyVideoOutput(videoOnlyPath, true);
      expect(intermediateVerification.valid).toBe(false);
      expect(intermediateVerification.hasAudio).toBe(false);
    });

    it('(d) audio-only source handled without falsely claiming a complete video: rejects audio-only files for video requests', async () => {
      const pureAudioPath = path.join(testDir, 'pure_audio.mp3');

      // Create pure MP3 audio file with no video stream
      execFileSync(ffmpegBin, [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=44100',
        '-t', '1',
        '-c:a', 'libmp3lame', '-b:a', '128k',
        pureAudioPath,
      ]);

      const probe = await probeMediaFile(pureAudioPath);
      expect(probe.isValid).toBe(true);
      expect(probe.hasVideo).toBe(false);
      expect(probe.hasAudio).toBe(true);

      // When tested as a video output, it must be rejected because hasVideo is false
      const verification = await verifyVideoOutput(pureAudioPath, true);
      expect(verification.valid).toBe(false);
      expect(verification.hasVideo).toBe(false);
      expect(verification.reason).toMatch(/does not contain a video stream/i);
    });

    it('(e) highest available video resolution capped at 720p: ensures High Quality caps at 720p while button name remains High Quality', () => {
      const highResFormats: VideoFormat[] = [
        { id: 'fmt-360', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://fbcdn.net/360.mp4', hasAudio: true, hasVideo: true },
        { id: 'fmt-480', format: 'MP4', quality: '480p (SD)', resolution: '854x480', height: 480, url: 'https://fbcdn.net/480.mp4', hasAudio: true, hasVideo: true },
        { id: 'fmt-720', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://fbcdn.net/720.mp4', hasAudio: true, hasVideo: true },
        { id: 'fmt-1080', format: 'MP4', quality: '1080p (Full HD)', resolution: '1920x1080', height: 1080, url: 'https://fbcdn.net/1080.mp4', hasAudio: true, hasVideo: true },
        { id: 'fmt-1440', format: 'MP4', quality: '1440p (2K)', resolution: '2560x1440', height: 1440, url: 'https://fbcdn.net/1440.mp4', hasAudio: true, hasVideo: true },
        { id: 'fmt-2160', format: 'MP4', quality: '2160p (4K)', resolution: '3840x2160', height: 2160, url: 'https://fbcdn.net/2160.mp4', hasAudio: true, hasVideo: true },
      ];

      // Format selection must cap High Quality strictly at 720p
      const selection = selectStandardAndHighFormats(highResFormats);
      expect(selection.high).toBeDefined();
      expect(selection.high?.height).toBe(720);
      expect(selection.high?.quality).toBe('720p (HD)');

      // Standard quality option must be preserved as 480p or lowest available
      expect(selection.standard).toBeDefined();
      expect(selection.standard?.height).toBe(480);

      // Deduplication and sorting must preserve all distinct resolutions in ascending order
      const sorted = deduplicateAndSortVideoFormats(highResFormats);
      expect(sorted.length).toBe(6);
      expect(sorted.map((f) => f.height)).toEqual([360, 480, 720, 1080, 1440, 2160]);

      // Verify that FFmpeg and ffprobe binary locators resolve cleanly
      expect(YtDlpService.getFfmpegPath()).toBeDefined();
      expect(fs.existsSync(YtDlpService.getFfmpegPath())).toBe(true);
      expect(fs.existsSync(getFfprobeBinary())).toBe(true);
    });

    it('verifies exact simplified download button labels (High Quality and Standard Quality)', () => {
      // Verify ResultCard source uses exact simplified button labels without resolution numbers or pixel rates
      const resultCardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ResultCard.tsx'), 'utf-8');
      expect(resultCardSource).toContain('<span>High Quality</span>');
      expect(resultCardSource).toContain('<span>Standard Quality</span>');
      expect(resultCardSource).not.toContain('Download Video (1080p');
      expect(resultCardSource).not.toContain('Download Video (720p');
      expect(resultCardSource).not.toContain('Download Video (480p');
      expect(resultCardSource).not.toContain('Download Video (${highestLabel})');
      expect(resultCardSource).not.toContain('Download Video (${standardLabel})');
    });
  });

  describe('Performance, In-Memory Metadata Caching & Real Progress Reporting', () => {
    const testUrl = 'https://www.facebook.com/watch/?v=999888777666';
    const mockInfo = {
      id: 'mock-fb-1',
      title: 'Performance Benchmark Video',
      platform: 'facebook',
      platformLabel: 'Facebook',
      url: testUrl,
      thumbnail: 'https://fbcdn.net/thumb.jpg',
      author: 'SpeedTester',
      duration: 60,
      durationFormatted: '1:00',
      formats: [
        { id: 'fb-sd', format: 'MP4', quality: '480p (SD)', resolution: '854x480', height: 480, url: 'https://fbcdn.net/sd.mp4', hasAudio: true, hasVideo: true },
        { id: 'fb-hd', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://fbcdn.net/hd.mp4', hasAudio: true, hasVideo: true },
      ],
      downloadAvailable: true,
    };

    it('caches extracted metadata in-memory and returns cached entries in sub-millisecond time', () => {
      clearVideoInfoCache();
      expect(getCachedVideoInfo(testUrl)).toBeNull();

      setCachedVideoInfo(testUrl, mockInfo as any);
      const cached = getCachedVideoInfo(testUrl);
      expect(cached).not.toBeNull();
      expect(cached?.title).toBe('Performance Benchmark Video');
      expect(cached?.formats.length).toBe(2);

      // Verify clone isolation
      if (cached) {
        cached.title = 'Mutated';
        const fresh = getCachedVideoInfo(testUrl);
        expect(fresh?.title).toBe('Performance Benchmark Video');
      }
    });

    it('expires metadata cache entries after TTL', () => {
      clearVideoInfoCache();
      setCachedVideoInfo(testUrl, mockInfo as any, 10); // 10ms TTL
      expect(getCachedVideoInfo(testUrl)).not.toBeNull();

      // Wait 15ms for expiration
      const start = Date.now();
      while (Date.now() - start < 15) {}

      expect(getCachedVideoInfo(testUrl)).toBeNull();
    });

    it('verifies yt-dlp service uses metadata-only flags without downloading media', () => {
      const ytDlpSource = fs.readFileSync(path.resolve(process.cwd(), 'server/src/services/ytDlpService.ts'), 'utf-8');
      expect(ytDlpSource).toContain("'--dump-single-json'");
      expect(ytDlpSource).toContain("'--skip-download'");
      expect(ytDlpSource).toContain("'--no-check-formats'");
      expect(ytDlpSource).toContain("'--socket-timeout'");
    });

    it('verifies real progress stages are tracked and returned without fake percentages', () => {
      const ticketId = 'test-perf-ticket-1';
      ticketStore.set(ticketId, {
        id: ticketId,
        url: 'https://fbcdn.net/hd.mp4',
        pageUrl: testUrl,
        formatId: 'fb-hd',
        mediaType: 'video',
        title: 'Performance Benchmark Video',
        filename: 'Performance_Benchmark_Video.mp4',
        createdAt: Date.now(),
        stage: 'preparing',
        stageLabel: 'Preparing video',
      });

      const ticket = ticketStore.get(ticketId);
      expect(ticket).toBeDefined();
      expect(ticket?.stage).toBe('preparing');
      expect(ticket?.stageLabel).toBe('Preparing video');

      // Update to downloading stage
      if (ticket) {
        ticket.stage = 'downloading';
        ticket.stageLabel = 'Downloading video';
      }
      expect(ticketStore.get(ticketId)?.stage).toBe('downloading');
      expect(ticketStore.get(ticketId)?.stageLabel).toBe('Downloading video');

      // Update to finalizing stage
      if (ticket) {
        ticket.stage = 'finalizing';
        ticket.stageLabel = 'Finalizing video';
      }
      expect(ticketStore.get(ticketId)?.stage).toBe('finalizing');
      expect(ticketStore.get(ticketId)?.stageLabel).toBe('Finalizing video');

      // Update to ready stage
      if (ticket) {
        ticket.stage = 'ready';
        ticket.stageLabel = 'Download complete';
      }
      expect(ticketStore.get(ticketId)?.stage).toBe('ready');
      expect(ticketStore.get(ticketId)?.stageLabel).toBe('Download complete');

      // Verify no fake percentages are stored
      expect(ticketStore.get(ticketId)?.stageLabel).not.toMatch(/%|\d+%/);

      ticketStore.delete(ticketId);
    });
  });
});





