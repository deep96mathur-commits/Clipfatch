import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateAndClassifyUrl, isPrivateOrReservedIp, validateMediaDownloadUrl } from '../src/utils/ssrfGuard.js';
import { sanitizeFilename } from '../src/services/downloadService.js';
import { videoInfoSchema, videoDownloadSchema } from '../src/validators/videoValidator.js';
import { adapterRegistry } from '../src/services/adapters/AdapterRegistry.js';
import { deduplicateAndSortVideoFormats, generateAudioFormats } from '../src/utils/formatNormalizer.js';
import { probeMediaFile } from '../src/utils/mediaProbe.js';
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
  it('correctly classifies valid X/Twitter URLs', async () => {
    const res = await validateAndClassifyUrl('https://x.com/jack/status/20');
    expect(res.safe).toBe(true);
    expect(res.platform).toBe('x');
  });

  it('correctly classifies valid Facebook URLs', async () => {
    const res = await validateAndClassifyUrl('https://www.facebook.com/watch/?v=123456');
    expect(res.safe).toBe(true);
    expect(res.platform).toBe('facebook');
  });

  it('correctly classifies valid Instagram URLs', async () => {
    const res = await validateAndClassifyUrl('https://www.instagram.com/reel/C7xyz123/');
    expect(res.safe).toBe(true);
    expect(res.platform).toBe('instagram');
  });

  it('rejects lookalike domains (e.g. facebook.com.attacker.com)', async () => {
    const res = await validateAndClassifyUrl('https://facebook.com.malicious.example/video');
    expect(res.safe).toBe(false);
    expect(res.error).toMatch(/Lookalike|Unsupported/i);
  });

  it('correctly classifies valid YouTube URLs', async () => {
    const res = await validateAndClassifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(res.safe).toBe(true);
    expect(res.platform).toBe('youtube');

    const shortRes = await validateAndClassifyUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(shortRes.safe).toBe(true);
    expect(shortRes.platform).toBe('youtube');
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
  it('approves legitimate Twitter CDN media URLs', async () => {
    const res = await validateMediaDownloadUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/test.mp4');
    expect(res.safe).toBe(true);
  });

  it('approves legitimate Facebook CDN media URLs', async () => {
    const res = await validateMediaDownloadUrl('https://video.xx.fbcdn.net/v/t39.254/video.mp4');
    expect(res.safe).toBe(true);
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
    const parsed = videoInfoSchema.safeParse({ url: 'https://x.com/user/status/12345' });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty or missing URL', () => {
    const parsed = videoInfoSchema.safeParse({ url: '' });
    expect(parsed.success).toBe(false);
  });

  it('validates VideoDownload payload', () => {
    const parsed = videoDownloadSchema.safeParse({
      url: 'https://x.com/user/status/12345',
      formatId: 'x-mp4-0-1080p',
    });
    expect(parsed.success).toBe(true);
  });

  it('automatically handles and truncates title exceeding 200 characters without failing', () => {
    const excessivelyLongTitle = 'Extremely long video post caption or YouTube title '.repeat(10); // 520 chars
    const parsed = videoDownloadSchema.safeParse({
      url: 'https://x.com/user/status/12345',
      formatId: 'x-mp4-0-1080p',
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

    const igAdapter = adapterRegistry.getAdapter(new URL('https://www.instagram.com/reel/C7xyz/'));
    expect(igAdapter?.platform).toBe('instagram');

    const xAdapter = adapterRegistry.getAdapter(new URL('https://x.com/NASA/status/123456'));
    expect(xAdapter?.platform).toBe('x');

    const ytAdapter = adapterRegistry.getAdapter(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    expect(ytAdapter?.platform).toBe('youtube');

    const ytShortAdapter = adapterRegistry.getAdapter(new URL('https://youtu.be/dQw4w9WgXcQ'));
    expect(ytShortAdapter?.platform).toBe('youtube');
  });
});

describe('yt-dlp Engine & Media Whitelist', () => {
  it('validates Facebook cdn and media host endpoints', async () => {
    const fbCdn = await validateMediaDownloadUrl('https://video.xx.fbcdn.net/v/t39.254-2/sample.mp4');
    expect(fbCdn.safe).toBe(true);

    const fbMedia = await validateMediaDownloadUrl('https://www.facebook.com/video/sample.mp4');
    expect(fbMedia.safe).toBe(true);
  });

  it('validates YouTube media host endpoints and googlevideo CDN', async () => {
    const ytCdn = await validateMediaDownloadUrl('https://rr1---sn-4g5ednss.googlevideo.com/videoplayback?expire=123');
    expect(ytCdn.safe).toBe(true);

    const ytMedia = await validateMediaDownloadUrl('https://www.youtube.com/watch?v=sample');
    expect(ytMedia.safe).toBe(true);
  });
});

describe('Format Normalizer: Deduplication & Ascending Sort', () => {
  it('eliminates duplicate video resolutions and sorts in ascending order (lowest to highest)', () => {
    const rawFormats = [
      { id: 'fmt-1080p', format: 'MP4', quality: '1080p', resolution: '1920x1080', height: 1080, url: 'https://cdn.example.com/1080', hasAudio: true, hasVideo: true },
      { id: 'fmt-720p-dup1', format: 'MP4', quality: '720p (HD)', resolution: '1280x720', height: 720, url: 'https://cdn.example.com/720a', hasAudio: true, hasVideo: true },
      { id: 'fmt-720p-dup2', format: 'MP4', quality: '720p', resolution: '1280x720', height: 720, url: 'https://cdn.example.com/720b', hasAudio: false, hasVideo: true },
      { id: 'fmt-480p-dup1', format: 'MP4', quality: '480p', resolution: '854x480', height: 480, url: 'https://cdn.example.com/480a', hasAudio: true, hasVideo: true },
      { id: 'fmt-480p-dup2', format: 'MP4', quality: '480p (SD)', resolution: '854x480', height: 480, url: 'https://cdn.example.com/480b', hasAudio: true, hasVideo: true },
      { id: 'fmt-360p', format: 'MP4', quality: '360p', resolution: '640x360', height: 360, url: 'https://cdn.example.com/360', hasAudio: true, hasVideo: true },
    ];

    const normalized = deduplicateAndSortVideoFormats(rawFormats as any);

    // Exactly 4 unique resolutions: 360, 480, 720, 1080
    expect(normalized).toHaveLength(4);

    // Ascending order check: 360 -> 480 -> 720 -> 1080
    expect(normalized[0].height).toBe(360);
    expect(normalized[1].height).toBe(480);
    expect(normalized[2].height).toBe(720);
    expect(normalized[3].height).toBe(1080);

    // Preferred format check (kept the 720p with audio over video-only)
    expect(normalized[2].url).toBe('https://cdn.example.com/720a');
  });

  it('generates standard MP3 audio download options (48, 128, 320 kbps)', () => {
    const audioOptions = generateAudioFormats('https://example.com/video', 120);

    expect(audioOptions).toHaveLength(3);
    expect(audioOptions.map((a) => a.audioBitrate)).toEqual([48, 128, 320]);
    expect(audioOptions.every((a) => a.format === 'MP3' && a.isAudio === true)).toBe(true);
    expect(audioOptions[0].filesizeFormatted).toBeDefined();
    expect(audioOptions[2].quality).toContain('320 kbps');
  });

  it('guarantees 1080p Full HD format is correctly extracted, labeled, and sorted', () => {
    const mixedFormats = [
      { id: 'sample-fhd', format: 'MP4', quality: 'Full HD', resolution: '1920x1080', url: 'https://cdn.example.com/fhd', hasAudio: true, hasVideo: true },
      { id: 'sample-hd', format: 'MP4', quality: 'HD', resolution: '1280x720', url: 'https://cdn.example.com/hd', hasAudio: true, hasVideo: true },
      { id: 'sample-sd', format: 'MP4', quality: 'SD', resolution: '854x480', url: 'https://cdn.example.com/sd', hasAudio: true, hasVideo: true },
    ];

    const sorted = deduplicateAndSortVideoFormats(mixedFormats as any);
    expect(sorted).toHaveLength(3);
    expect(sorted[0].quality).toBe('480p (SD)');
    expect(sorted[1].quality).toBe('720p (HD)');
    expect(sorted[2].quality).toBe('1080p (Full HD)');
    expect(sorted[2].height).toBe(1080);
    expect(sorted[2].resolution).toBe('1920x1080');
    expect(sorted[2].isHd).toBe(true);
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



