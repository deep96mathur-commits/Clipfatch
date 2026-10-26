import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');
const targetFile = path.join(binDir, 'yt-dlp');
const DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

async function main() {
  // Only runs on Linux
  if (process.platform !== 'linux') {
    return;
  }

  try {
    // Skip download if bin/yt-dlp already exists and is the valid standalone binary
    if (fs.existsSync(targetFile)) {
      try {
        const stats = fs.statSync(targetFile);
        if (stats.size > 10 * 1024 * 1024) {
          fs.chmodSync(targetFile, 0o755);
          console.log('[ytdlp] ready');
          return;
        }
      } catch (_) {}
    }

    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    console.log('[ytdlp] downloading standalone Linux binary...');
    const res = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(targetFile, buffer);
    fs.chmodSync(targetFile, 0o755);

    console.log('[ytdlp] ready');
  } catch (err) {
    // Log the error without crashing the install if download fails
    console.error('[ytdlp] download warning:', err.message);
  }
}

main();
