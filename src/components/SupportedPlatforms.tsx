import React from 'react';
import { Check } from 'lucide-react';

interface SupportedPlatformsProps {
  onSelectSample: (sampleUrl: string) => void;
}

export const SupportedPlatforms: React.FC<SupportedPlatformsProps> = ({ onSelectSample }) => {
  return (
    <section id="platforms" className="py-16 sm:py-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-14">
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wider mb-4">
          Facebook Content Types
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
          Supported Facebook Formats
        </h2>
        <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-600 dark:text-slate-400">
          ClipFetch works exclusively with all types of public Facebook video content. Only public videos are supported.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Facebook Reels */}
        <div className="feature-card-scroll feature-card-item p-6 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col justify-between">
          <div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#1877F2] text-white flex items-center justify-center font-bold text-xl shadow-xs">
                f
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Facebook Reels
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Vertical short-form video reels with background audio.
            </p>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>facebook.com/reel/... links</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Full HD 1080p / 720p resolution</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>MP3 audio extraction</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Audio tracks up to 320 kbps</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => onSelectSample('https://www.facebook.com/reel/10158792070386729')}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer text-center"
          >
            Try Reels Sample
          </button>
        </div>

        {/* Facebook Watch */}
        <div className="feature-card-scroll feature-card-item p-6 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col justify-between">
          <div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#1877F2] text-white flex items-center justify-center font-bold text-xl shadow-xs">
                ▶
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Facebook Watch
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Original creator shows, series, and full episodes.
            </p>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>facebook.com/watch/?v=...</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>High definition HD streaming</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Full episode durations</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Clean MP4 output with audio</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => onSelectSample('https://www.facebook.com/watch/?v=10158792070386729')}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer text-center"
          >
            Try Watch Sample
          </button>
        </div>

        {/* Facebook Page & Post Videos */}
        <div className="feature-card-scroll feature-card-item p-6 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col justify-between">
          <div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#1877F2] text-white flex items-center justify-center font-bold text-xl shadow-xs">
                📰
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Page & Feed Posts
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Public page timeline video posts and community clips.
            </p>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Page timeline video posts</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Public post permalinks</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>SD & HD video quality</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>MP3 voice / podcast tracks</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => onSelectSample('https://www.facebook.com/facebook/videos/10158792070386729')}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer text-center"
          >
            Try Page Video Sample
          </button>
        </div>

        {/* fb.watch & Short Links */}
        <div className="feature-card-scroll feature-card-item p-6 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col justify-between">
          <div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#1877F2] text-white flex items-center justify-center font-bold text-xl shadow-xs">
                🔗
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              fb.watch Short Links
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Mobile app share links and m.facebook.com URLs.
            </p>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>fb.watch short links</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>m.facebook.com mobile URLs</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>fb.gg gaming clips</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>web.facebook.com links</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => onSelectSample('https://fb.watch/sampleReel/')}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer text-center"
          >
            Try Short Link Sample
          </button>
        </div>
      </div>
    </section>
  );
};
