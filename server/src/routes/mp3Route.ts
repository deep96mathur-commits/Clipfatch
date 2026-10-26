import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import type { Request, Response } from 'express';

const require = createRequire(import.meta.url);
const { YOUTUBE_DL_PATH } = require('youtube-dl-exec/src/constants');

const ALLOWED_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'];

const localBinYtdlp = path.join(process.cwd(), 'bin', 'yt-dlp');
const YTDLP =
  process.env.YTDLP_PATH ||
  (fs.existsSync(localBinYtdlp) ? localBinYtdlp : (YOUTUBE_DL_PATH || 'yt-dlp'));

const TIMEOUT_MS = 120000;
const MAX_JOBS = 2;
let activeJobs = 0;

async function getFfmpegPath(): Promise<string | null> {
  try {
    const name = 'ffmpeg-static';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(name);
    const p = mod.default || mod;
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch {
    // not installed, fall back to system ffmpeg
  }
  return null;
}

function fail(res: Response, status: number, message: string, debug?: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const errorObj: { message: string; debug?: string } = { message };
  if (debug) {
    errorObj.debug = debug;
  }
  res.status(status).json({ success: false, error: errorObj });
}

// Log yt-dlp path, file existence, and ffmpeg path at server start
(async () => {
  const exists = fs.existsSync(YTDLP);
  console.log(`[mp3] yt-dlp path: ${YTDLP} (exists: ${exists})`);

  try {
    const ff = await getFfmpegPath();
    console.log(`[mp3] ffmpeg: ${ff || 'not found'}`);
  } catch {
    console.log('[mp3] ffmpeg: detection error');
  }

  if (exists) {
    try {
      const p = spawn(YTDLP, ['--version']);
      let out = '';
      p.stdout?.on('data', (d) => {
        out += d.toString();
      });
      p.on('close', (code) => {
        if (code === 0) {
          console.log(`[mp3] yt-dlp version: ${out.trim()}`);
        } else {
          console.log(`[mp3] yt-dlp version: check failed (exit code ${code})`);
        }
      });
      p.on('error', (err) => {
        console.log(`[mp3] yt-dlp version: not found (${err.message})`);
      });
    } catch (err) {
      console.log(`[mp3] yt-dlp version: error (${(err as Error).message})`);
    }
  }
})();

export async function mp3Handler(req: Request, res: Response) {
  const rawUrl = String(req.query.url || '');
  const title = String(req.query.title || '');

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail(res, 400, 'Invalid link.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return fail(res, 400, 'Only Facebook links are supported.');
  }
  if (activeJobs >= MAX_JOBS) {
    return fail(res, 503, 'The server is busy converting other files. Please try again in a minute.');
  }

  activeJobs++;
  const started = Date.now();
  let dir = '';
  let child: ReturnType<typeof spawn> | null = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    activeJobs--;
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
  };
  res.on('close', finish);

  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3-'));
    const ffmpegPath = await getFfmpegPath();

    const args = [
      '--no-playlist',
      '--no-warnings',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      '-o', path.join(dir, 'audio.%(ext)s'),
    ];
    if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
    args.push('--', rawUrl);

    child = spawn(YTDLP, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    const timer = setTimeout(() => child?.kill('SIGKILL'), TIMEOUT_MS);

    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      console.error('[mp3] could not start yt-dlp:', e.message);
      fail(
        res,
        500,
        e.code === 'ENOENT'
          ? 'yt-dlp is not installed on the server (or set YTDLP_PATH).'
          : 'Could not start the converter.'
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (res.writableEnded || res.destroyed) return;

      if (code !== 0) {
        const last20Lines = stderrTail.split('\n').slice(-20).join('\n');
        console.error('[mp3] yt-dlp stderr:\n' + last20Lines);
        const missingFfmpeg = /ffmpeg|ffprobe/i.test(stderrTail) && /not found|not installed/i.test(stderrTail);
        return fail(
          res,
          502,
          missingFfmpeg
            ? 'The server is missing ffmpeg, so MP3 conversion is not possible yet.'
            : 'Could not get the audio for this video. It may be private, restricted, or the link may be old.',
          stderrTail.slice(-300)
        );
      }

      const file = path.join(dir, 'audio.mp3');
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
      if (size < 10000) {
        console.error('[mp3] output missing or too small, size =', size);
        return fail(res, 502, 'The MP3 file came out empty. Please try again.');
      }

      const safe = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'ClipFetch_Facebook_Audio';
      const fname = `${safe}_128kbps.mp3`;
      const ascii = fname.replace(/[^\x20-\x7E]/g, '_');

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(size));
      res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fname)}`);

      console.log(`[mp3] ok, ${size} bytes, ${Date.now() - started} ms`);

      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  } catch (e) {
    console.error('[mp3] unexpected error:', (e as Error).message);
    fail(res, 500, 'Unexpected server error while preparing the MP3.');
  }
}
