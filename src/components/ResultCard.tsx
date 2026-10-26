import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Clock,
  Globe,
  Layers,
  Download,
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
  ShieldAlert,
  Music,
  Video,
  ExternalLink,
} from 'lucide-react';
import { VideoInfo, VideoFormat } from '../types/index.ts';
import { triggerDownload } from '../services/api.ts';

interface ResultCardProps {
  video: VideoInfo;
  onReset: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ video, onReset }) => {
  // Extract or synthesize strictly the 480p and 720p video formats
  const rawVideoFormats = video.formats.filter((f) => !f.isAudio && f.mediaType !== 'audio');

  const raw480 =
    rawVideoFormats.find((f) => f.height === 480) ||
    rawVideoFormats.find((f) => f.id.includes('480'));
  const raw720 =
    rawVideoFormats.find((f) => f.height === 720) ||
    rawVideoFormats.find((f) => f.id.includes('720'));

  const fallbackUrl = rawVideoFormats[0]?.url || video.originalUrl;

  // STRICT REQUIREMENT: Only two formats for video: 480p and 720p
  const standardQualityFormat: VideoFormat = raw480 || {
    id: 'fb-480p',
    format: 'MP4',
    quality: '480p (SD)',
    resolution: '854x480',
    height: 480,
    url: fallbackUrl,
    hasAudio: true,
    hasVideo: true,
    isHd: false,
    mediaType: 'video',
  };

  const highQualityFormat: VideoFormat = raw720 || {
    id: 'fb-720p',
    format: 'MP4',
    quality: '720p (HD)',
    resolution: '1280x720',
    height: 720,
    url: fallbackUrl,
    hasAudio: true,
    hasVideo: true,
    isHd: true,
    mediaType: 'video',
  };

  // STRICT REQUIREMENT: Only audio format is 128kbps
  const raw128Audio = video.formats.find(
    (f) => (f.isAudio || f.mediaType === 'audio') && (f.audioBitrate === 128 || f.id.includes('128'))
  );

  const audio128Format: VideoFormat = raw128Audio || {
    id: 'audio-mp3-128k',
    format: 'MP3',
    quality: '128 kbps',
    url: video.originalUrl,
    isAudio: true,
    audioBitrate: 128,
    mediaType: 'audio',
  };

  const [activeDownloadingTarget, setActiveDownloadingTarget] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadErrorDebug, setDownloadErrorDebug] = useState<string | null>(null);
  const [activeDownloadUrl, setActiveDownloadUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [mp3ExtendedWait, setMp3ExtendedWait] = useState(false);
  const mp3TimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (mp3TimerRef.current) {
        clearTimeout(mp3TimerRef.current);
      }
    };
  }, []);

  // Return real file size if known, null otherwise
  const getFormatFileSize = (fmt: VideoFormat): string | null => {
    if (fmt.filesizeFormatted) return fmt.filesizeFormatted;
    if (fmt.filesize && fmt.filesize > 0) {
      const mb = fmt.filesize / (1024 * 1024);
      return `${mb.toFixed(1)} MB`;
    }
    return null;
  };

  const executeDownload = async (targetFormat: VideoFormat, targetKey: '480' | '720' | '128') => {
    setActiveDownloadingTarget(targetKey);
    setDownloadError(null);
    setDownloadErrorDebug(null);
    setDownloadSuccess(null);

    if (mp3TimerRef.current) {
      clearTimeout(mp3TimerRef.current);
      mp3TimerRef.current = null;
    }
    setMp3ExtendedWait(false);

    if (targetKey === '128') {
      mp3TimerRef.current = setTimeout(() => {
        setMp3ExtendedWait(true);
      }, 15000);
    }

    const isAudio = targetKey === '128';

    try {
      if (isAudio) {
        const mp3Url = `/api/mp3?url=${encodeURIComponent(video.originalUrl)}&title=${encodeURIComponent((video.title || '').slice(0, 80))}`;
        setActiveDownloadUrl(mp3Url);

        const res = await fetch(mp3Url);
        if (!res.ok) {
          let msg = 'MP3 conversion failed. Please try again.';
          try {
            const j = await res.json();
            msg = j?.error?.message || msg;
            if (j?.error?.debug) {
              setDownloadErrorDebug(j.error.debug);
            }
          } catch {
            // keep default message
          }
          throw new Error(msg);
        }

        const blob = await res.blob();
        if (blob.size < 10000) throw new Error('The MP3 came back too small. Please try again.');

        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `${(video.title || 'ClipFetch_Facebook_Audio').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}_HighQuality.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 10000);

        setDownloadSuccess('MP3 download started.');
        setTimeout(() => setDownloadSuccess(null), 8000);
        return;
      }

      // 1. Prepare download ticket/endpoint from the backend
      const result = await triggerDownload({
        url: video.originalUrl,
        formatId: targetKey === '480' ? 'fb-480p' : targetKey === '720' ? 'fb-720p' : 'audio-mp3-128k',
        quality: targetKey === '480' ? 'standard' : targetKey === '720' ? 'high' : '128',
        targetMediaUrl: targetFormat.url,
        title: video.title
          ? video.title.length > 190
            ? video.title.slice(0, 187) + '...'
            : video.title
          : undefined,
        mediaType: isAudio ? 'audio' : 'video',
        audioBitrate: isAudio ? 128 : undefined,
      });

      // Ensure download URL is relative on same origin
      const relativeUrl =
        result.downloadUrl.startsWith('http://') || result.downloadUrl.startsWith('https://')
          ? new URL(result.downloadUrl).pathname + new URL(result.downloadUrl).search
          : result.downloadUrl.startsWith('/')
          ? result.downloadUrl
          : `/${result.downloadUrl}`;

      setActiveDownloadUrl(relativeUrl);

      // 2. Pre-check with a lightweight HEAD request on the same origin
      // Only show "Download blocked" when the response is text/html or not 200
      let preCheckPassed = true;
      let blockedMessage = '';

      try {
        const checkRes = await fetch(relativeUrl, {
          method: 'HEAD',
          headers: {
            Accept: isAudio ? 'audio/mpeg, */*' : 'video/mp4, */*',
          },
        });

        const contentType = (checkRes.headers.get('content-type') || '').toLowerCase();

        if (!checkRes.ok || checkRes.status !== 200 || contentType.includes('text/html')) {
          preCheckPassed = false;
          blockedMessage =
            'Download blocked. Please open the site in a normal browser tab and allow cookies, then try again.';
        }
      } catch {
        // Fallback probe to /api/check if HEAD was blocked by proxy
        try {
          const apiCheck = await fetch('/api/check', { method: 'GET' });
          if (!apiCheck.ok) {
            preCheckPassed = false;
            blockedMessage =
              'Download blocked. Please open the site in a normal browser tab and allow cookies, then try again.';
          }
        } catch {
          preCheckPassed = false;
          blockedMessage =
            'Download blocked. Please open the site in a normal browser tab and allow cookies, then try again.';
        }
      }

      if (!preCheckPassed) {
        throw new Error(
          blockedMessage ||
            'Download blocked. Please open the site in a normal browser tab and allow cookies, then try again.'
        );
      }

      // 3. Start download with a plain link / top-level navigation to /api/download
      // on the same origin as the page (NOT fetch + blob), so browser attaches first-party cookies natively
      const link = document.createElement('a');
      link.href = relativeUrl;
      link.setAttribute('download', result.filename);
      link.setAttribute('rel', 'noopener noreferrer');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setDownloadSuccess(
        `Download started for ${result.filename}! If it does not start automatically, click the direct link below.`
      );
      setTimeout(() => setDownloadSuccess(null), 8000);
    } catch (err: unknown) {
      setDownloadError((err as Error).message || 'Failed to download file.');
    } finally {
      if (mp3TimerRef.current) {
        clearTimeout(mp3TimerRef.current);
        mp3TimerRef.current = null;
      }
      setMp3ExtendedWait(false);
      setActiveDownloadingTarget(null);
    }
  };

  const getPlatformIcon = () => {
    return (
      <div className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-xs shrink-0">
        f
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fadeIn">
      {/* Back Button */}
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-6 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Try Another Link</span>
      </button>

      {/* Main Download Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-0">
          {/* Media Preview Box (Left / Top) */}
          <div className="md:col-span-5 relative bg-slate-950 flex items-center justify-center min-h-[260px] sm:min-h-[320px] overflow-hidden group">
            {isPlayingPreview && highQualityFormat.url ? (
              <video
                src={highQualityFormat.url}
                controls
                autoPlay
                className="w-full h-full max-h-[440px] object-contain"
              />
            ) : video.thumbnail ? (
              <>
                <img
                  src={video.thumbnail}
                  alt={video.title ? `${video.title} - Facebook video downloader HD MP4 and MP3` : 'Facebook video downloader HD MP4 and MP3'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full max-h-[440px] object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-slate-950/35 backdrop-brightness-90 flex items-center justify-center">
                  <button
                    onClick={() => {
                      if (highQualityFormat.url) {
                        setIsPlayingPreview(true);
                      }
                    }}
                    className="w-14 h-14 rounded-full bg-slate-900/80 hover:bg-blue-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 cursor-pointer"
                    aria-label="Play video preview"
                  >
                    <Play className="w-6 h-6 fill-white ml-1" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Play className="w-12 h-12 mb-3 text-slate-600" />
                <p className="text-sm font-medium">Video Preview</p>
                <p className="text-xs text-slate-500 mt-1">{video.platformLabel}</p>
              </div>
            )}

            {/* Duration pill overlay */}
            {video.durationFormatted && (
              <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur-xs text-white text-xs font-mono font-medium tracking-wider">
                {video.durationFormatted}
              </div>
            )}
          </div>

          {/* Details & Format Selection (Right / Bottom) */}
          <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              {/* Platform Label */}
              <div className="flex items-center gap-2 mb-3">
                {getPlatformIcon()}
                <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                  {video.platformLabel}
                </span>
              </div>

              {/* Video Title */}
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-snug mb-2 line-clamp-2">
                {video.title || 'Facebook Video'}
              </h2>

              {/* Author / Description */}
              {video.author && (
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-5">
                  By {video.author}
                </p>
              )}

              {/* Quick Metrics Row: Only 2 video formats (480p, 720p) + 1 audio format (128 kbps) */}
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 mb-6 text-center">
                <div className="flex flex-col items-center justify-center">
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Duration</span>
                  </div>
                  <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 font-mono">
                    {video.durationFormatted || '--:--'}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center border-x border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                    <Globe className="w-3.5 h-3.5" />
                    <span>Platform</span>
                  </div>
                  <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 capitalize">
                    {video.platform}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center">
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Formats</span>
                  </div>
                  <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
                    2 video + 1 audio
                  </span>
                </div>
              </div>

              {/* Dedicated Download Buttons (720p HD, 480p, MP3 High Quality) */}
              {video.downloadAvailable ? (
                <div className="flex flex-col gap-3 mb-6">
                  {/* Button 1: 720p HD */}
                  <button
                    type="button"
                    title="Download Facebook video in 720p HD"
                    onClick={() => executeDownload(highQualityFormat, '720')}
                    disabled={activeDownloadingTarget !== null}
                    className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-98"
                  >
                    {activeDownloadingTarget === '720' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Preparing 720p...</span>
                      </>
                    ) : (
                      <>
                        <Video className="w-4 h-4 text-white" />
                        <span>Download Video (720p HD)</span>
                      </>
                    )}
                  </button>

                  {/* Button 2: 480p */}
                  <button
                    type="button"
                    title="Download Facebook video in 480p"
                    onClick={() => executeDownload(standardQualityFormat, '480')}
                    disabled={activeDownloadingTarget !== null}
                    className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-98"
                  >
                    {activeDownloadingTarget === '480' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Preparing 480p...</span>
                      </>
                    ) : (
                      <>
                        <Video className="w-4 h-4 text-white" />
                        <span>Download Video (480p)</span>
                      </>
                    )}
                  </button>

                  {/* Button 3: MP3 (High Quality) */}
                  <button
                    type="button"
                    title="Download Facebook audio in high quality MP3"
                    onClick={() => executeDownload(audio128Format, '128')}
                    disabled={activeDownloadingTarget !== null}
                    className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-purple-600 hover:bg-purple-700 shadow-md shadow-purple-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-98"
                  >
                    {activeDownloadingTarget === '128' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Converting MP3...</span>
                      </>
                    ) : (
                      <>
                        <Music className="w-4 h-4 text-white" />
                        <span>Download MP3 (High Quality)</span>
                      </>
                    )}
                  </button>

                  {/* Wait note: while any download is in progress */}
                  {activeDownloadingTarget !== null && (
                    <div className="mt-1 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start sm:items-center gap-3 text-xs sm:text-sm font-medium text-amber-800 dark:text-amber-200 shadow-xs wait-note-animated">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                      <span>
                        {activeDownloadingTarget === '128' && mp3ExtendedWait
                          ? 'Still working... converting audio takes a little longer. Thank you for your patience!'
                          : '⏳ Please wait! Your file is being prepared. This can take 30 seconds to 2 minutes depending on the video length. Do not close or refresh this page.'}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* Unsupported / Restricted State */
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 mb-6">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                      <p className="font-semibold mb-1">Direct Download Unavailable for this Post</p>
                      <p>
                        {video.message ||
                          'This platform restricts media retrieval behind a user login or privacy restriction.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Feedback Toasts & Direct Tab Fallback */}
            <div>
              {downloadSuccess && (
                <div className="flex items-center gap-2 mt-3 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/40">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{downloadSuccess}</span>
                </div>
              )}

              {downloadError && (
                <div className="mt-3.5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5 text-xs sm:text-sm text-rose-700 dark:text-rose-300 font-medium leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span>{downloadError}</span>
                      {downloadErrorDebug && (
                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono break-all leading-normal">
                          {downloadErrorDebug}
                        </p>
                      )}
                    </div>
                  </div>

                  {activeDownloadUrl && (
                    <div className="pt-2 border-t border-rose-200/70 dark:border-rose-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <span className="text-[11px] text-rose-600 dark:text-rose-400">
                        Solve cookie checks automatically by opening directly:
                      </span>
                      <a
                        href={activeDownloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-transform active:scale-95 cursor-pointer whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Direct Link in New Tab</span>
                      </a>
                    </div>
                  )}
                </div>
              )}

              {activeDownloadUrl && !downloadError && (
                <div className="mt-2.5 text-center">
                  <a
                    href={activeDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open Direct Link in New Tab</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Compliance & Safety Notice */}
      <div className="mt-4 p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
        <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <span>
          <strong>Note:</strong> Only download content that you have the right to download and that is publicly available. Respect copyright and platform terms of service.
        </span>
      </div>
    </div>
  );
};
