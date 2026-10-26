import React from 'react';
import { Link2, Search, Download, ArrowRight } from 'lucide-react';

export const HowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="py-16 sm:py-24 bg-slate-100/60 dark:bg-slate-900/50 transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Section Kicker */}
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wider mb-4">
          How It Works
        </div>

        {/* Section Heading */}
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-14">
          Get Your Videos in 3 Simple Steps
        </h2>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Step 1 */}
          <div className="feature-card-scroll feature-card-item relative p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white font-extrabold text-lg flex items-center justify-center shadow-md shadow-blue-500/25 mb-6">
              1
            </div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-5">
              <Link2 className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Paste the Link
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Copy the video or reel link from Facebook and paste it into the box.
            </p>
          </div>

          {/* Desktop connecting arrow 1 -> 2 */}
          <div className="hidden md:flex absolute top-1/2 left-[31.5%] -translate-y-1/2 -translate-x-1/2 z-10 text-slate-300 dark:text-slate-700">
            <ArrowRight className="w-7 h-7" />
          </div>

          {/* Step 2 */}
          <div className="feature-card-scroll feature-card-item relative p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-extrabold text-lg flex items-center justify-center shadow-md shadow-indigo-500/25 mb-6">
              2
            </div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-5">
              <Search className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Get Video Info
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              We&apos;ll fetch the video details and available download options.
            </p>
          </div>

          {/* Desktop connecting arrow 2 -> 3 */}
          <div className="hidden md:flex absolute top-1/2 left-[65%] -translate-y-1/2 -translate-x-1/2 z-10 text-slate-300 dark:text-slate-700">
            <ArrowRight className="w-7 h-7" />
          </div>

          {/* Step 3 */}
          <div className="feature-card-scroll feature-card-item relative p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-md shadow-slate-200/30 dark:shadow-slate-950/30 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white font-extrabold text-lg flex items-center justify-center shadow-md shadow-rose-500/25 mb-6">
              3
            </div>
            <div className="feature-icon-float w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-500 dark:text-rose-400 flex items-center justify-center mb-5">
              <Download className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Download
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Choose your preferred quality and download the video.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
