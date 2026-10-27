import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Link as LinkIcon,
  Clipboard,
  X as ClearIcon,
  ArrowRight,
  Loader2,
  Zap,
  ShieldCheck,
  Smartphone,
  Lock,
  AlertCircle,
} from 'lucide-react';

export interface HeroHandle {
  focusInput: () => void;
  setUrl: (url: string) => void;
}

interface HeroProps {
  onFetchVideo: (url: string) => void;
  isLoading: boolean;
  onOpenTerms: () => void;
}

export const Hero = forwardRef<HeroHandle, HeroProps>(({
  onFetchVideo,
  isLoading,
  onOpenTerms,
}, ref) => {
  const [url, setUrlState] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    setUrl: (newUrl: string) => {
      setUrlState(newUrl);
      setInputError(null);
      inputRef.current?.focus();
    },
  }));

  const handlePaste = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        setClipboardNotice('Clipboard access not supported in this browser. Please paste manually using Ctrl+V or Cmd+V.');
        setTimeout(() => setClipboardNotice(null), 4000);
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlState(text.trim());
        setInputError(null);
        setClipboardNotice(null);
      } else {
        setClipboardNotice('Clipboard is empty.');
        setTimeout(() => setClipboardNotice(null), 3000);
      }
    } catch {
      setClipboardNotice('Clipboard permission was denied. Please paste manually using Ctrl+V or ⌘+V.');
      setTimeout(() => setClipboardNotice(null), 4000);
    }
  };

  const handleClear = () => {
    setUrlState('');
    setInputError(null);
    inputRef.current?.focus();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanUrl = url.trim();

    if (!cleanUrl) {
      setInputError('Please enter or paste a video link to continue.');
      inputRef.current?.focus();
      return;
    }

    try {
      const parsed = new URL(cleanUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setInputError('Please enter a valid HTTP or HTTPS video URL.');
        return;
      }
      const host = parsed.hostname.toLowerCase();
      const allowedDomains = ['facebook.com', 'fb.watch', 'fb.gg'];
      const isAllowedHost = allowedDomains.some((domain) => host === domain || host.endsWith('.' + domain));
      if (!isAllowedHost) {
        setInputError('Please enter a valid Facebook link (facebook.com or fb.watch).');
        return;
      }
    } catch {
      setInputError('Please enter a valid Facebook link (e.g. https://www.facebook.com/watch/...)');
      return;
    }

    setInputError(null);
    onFetchVideo(cleanUrl);
  };

  const handleSampleClick = (sampleUrl: string) => {
    setUrlState(sampleUrl);
    setInputError(null);
    inputRef.current?.focus();
  };

  return (
    <section className="relative pt-12 pb-16 sm:pt-20 sm:pb-24 overflow-hidden">
      {/* Subtle Background Glow Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 pointer-events-none -z-10 opacity-60 dark:opacity-20 overflow-hidden">
        <div className="absolute top-10 left-1/4 w-80 h-80 rounded-full bg-blue-300/40 blur-3xl hero-bg-circle-1" />
        <div className="absolute top-12 right-1/4 w-80 h-80 rounded-full bg-indigo-300/30 blur-3xl hero-bg-circle-2" />
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Top Kicker Badge */}
        <div className="hero-entrance-badge inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 text-xs sm:text-sm font-medium mb-6 shadow-xs text-center leading-snug max-w-full">
          <span>Free Facebook Video Downloader & Free Reel Downloader</span>
        </div>

        {/* Hero Title */}
        <h1 className="hero-entrance-heading text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.15] mb-5">
          Download Facebook Videos in{' '}
          <span className="shimmer-seconds bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Seconds
          </span>
        </h1>

        {/* Subtitle */}
        <p className="hero-entrance-sub max-w-2xl mx-auto text-base sm:text-lg text-slate-600 dark:text-slate-300 mb-8 leading-relaxed">
          Paste a public link to any Facebook Reel, Watch episode, or timeline video to download in high quality MP4 or MP3.
        </p>

        {/* Platform Pill Helpers */}
        <div className="hero-entrance-chips flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 mb-8">
          <button
            type="button"
            onClick={() => handleSampleClick('https://www.facebook.com/reel/10158792070386729')}
            className="chip-hover inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer group"
          >
            <div className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-xs">
              f
            </div>
            <span>Facebook Reel Downloader</span>
          </button>

          <button
            type="button"
            onClick={() => handleSampleClick('https://www.facebook.com/watch/?v=10158792070386729')}
            className="chip-hover inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer group"
          >
            <div className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-xs">
              f
            </div>
            <span>Facebook Watch Downloader</span>
          </button>

          <button
            type="button"
            onClick={() => handleSampleClick('https://fb.watch/sampleReel/')}
            className="chip-hover inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer group"
          >
            <div className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-xs">
              f
            </div>
            <span>fb.watch Link Downloader</span>
          </button>
        </div>

        {/* Input Bar Form */}
        <form onSubmit={handleSubmit} className="hero-entrance-form relative max-w-3xl mx-auto mb-4">
          <div className="p-2 sm:p-2.5 bg-white dark:bg-slate-800/90 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 border border-slate-200/90 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 transition-all focus-within:border-blue-500 dark:focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10">
            {/* Input & Prefix Icon */}
            <div className="flex items-center flex-1 min-w-0 px-3 py-1">
              <LinkIcon className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0 mr-3" />
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => {
                  setUrlState(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="Paste Facebook video, reel, or watch link here..."
                className="w-full text-sm sm:text-base bg-transparent border-0 outline-hidden text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                disabled={isLoading}
                aria-label="Facebook Video URL input"
              />
              {url && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ml-2"
                  aria-label="Clear input"
                >
                  <ClearIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Actions Inside Input Bar */}
            <div className="flex items-center gap-2 justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/50">
              <button
                type="button"
                onClick={handlePaste}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Clipboard className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>Paste</span>
              </button>

              <button
                type="submit"
                disabled={isLoading}
                className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                  !url.trim() && !isLoading ? 'get-video-pulse' : ''
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Fetching...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    <span>Get Video</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Validation Error Message */}
          {inputError && (
            <div className="flex items-center justify-center gap-2 mt-3 text-sm text-rose-600 dark:text-rose-400 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{inputError}</span>
            </div>
          )}

          {/* Clipboard Notice */}
          {clipboardNotice && (
            <div className="flex items-center justify-center gap-2 mt-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{clipboardNotice}</span>
            </div>
          )}
        </form>

        {/* Disclaimer Note */}
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-14">
          By using ClipFetch, you agree to our{' '}
          <button
            type="button"
            onClick={onOpenTerms}
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
          >
            Terms of Service
          </button>
          . Please respect the rights of content owners.
        </p>

        {/* 4 Feature Highlights Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 text-left">
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Zap className="w-5 h-5 fill-amber-500/20" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Fast Download</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Get your videos in seconds</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">High Quality</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">480p SD & 720p HD</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Works on All Devices</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Mobile, tablet and desktop</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">100% Secure</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">No login required</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

Hero.displayName = 'Hero';
