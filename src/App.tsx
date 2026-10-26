import { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { Hero, HeroHandle } from './components/Hero.tsx';
import { ResultCard } from './components/ResultCard.tsx';
import { HowItWorks } from './components/HowItWorks.tsx';
import { SupportedPlatforms } from './components/SupportedPlatforms.tsx';
import { FaqSection } from './components/FaqSection.tsx';
import { AdContainer } from './components/AdContainer.tsx';
import { LegalModals } from './components/LegalModals.tsx';
import { Footer } from './components/Footer.tsx';
import { VideoInfo, ModalType } from './types/index.ts';
import { fetchVideoInfo, checkApiHealth } from './services/api.ts';
import { AlertCircle, X, ServerOff } from 'lucide-react';

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [backendNoticeDismissed, setBackendNoticeDismissed] = useState(false);

  const heroRef = useRef<HeroHandle>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Check backend health on mount
  useEffect(() => {
    let mounted = true;
    checkApiHealth().then((status) => {
      if (mounted) {
        setBackendOffline(!status.isOnline);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleFetchVideo = async (url: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchVideoInfo(url);
      setVideoData(data);

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Failed to retrieve video details. Please check the URL and try again.';
      setErrorMessage(msg);
      setVideoData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setVideoData(null);
    setErrorMessage(null);
    setTimeout(() => {
      heroRef.current?.focusInput();
    }, 50);
  };

  const handleNavClick = (sectionId: string) => {
    if (sectionId === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      heroRef.current?.focusInput();
      return;
    }

    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSelectSample = (sampleUrl: string) => {
    heroRef.current?.setUrl(sampleUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors selection:bg-blue-100 dark:selection:bg-blue-900 selection:text-blue-900 dark:selection:text-blue-100">
      {/* Backend Status Notice */}
      {backendOffline && !backendNoticeDismissed && (
        <div
          role="status"
          className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between"
        >
          <div className="flex items-center gap-2 max-w-7xl mx-auto flex-1">
            <ServerOff className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Backend server is currently warming up or unavailable. Video analysis might take longer.
            </span>
          </div>
          <button
            onClick={() => setBackendNoticeDismissed(true)}
            className="p-1 hover:bg-amber-500/10 rounded-md transition-colors cursor-pointer text-amber-800 dark:text-amber-200"
            aria-label="Dismiss backend warning"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Global Header */}
      <Header
        onNavClick={handleNavClick}
        onFocusInput={() => heroRef.current?.focusInput()}
      />

      <main className="flex-1">
        {/* Hero & Input Form */}
        <Hero
          ref={heroRef}
          onFetchVideo={handleFetchVideo}
          isLoading={isLoading}
          onOpenTerms={() => setActiveModal('terms')}
        />

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="max-w-4xl mx-auto px-4 mt-6 animate-fadeIn">
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-3 shadow-xs">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  Could not retrieve video
                </h4>
                <p className="text-sm text-rose-700 dark:text-rose-300 mt-0.5">
                  {errorMessage}
                </p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="p-1 rounded-lg text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Result Card when video analysis succeeds */}
        {videoData && (
          <div ref={resultRef} className="scroll-mt-24">
            <ResultCard video={videoData} onReset={handleReset} />
          </div>
        )}

        {/* Non-intrusive Ad placement */}
        <AdContainer slotId="hero-bottom" />

        {/* Supported Platforms Grid */}
        <SupportedPlatforms onSelectSample={handleSelectSample} />

        {/* How It Works Explainer */}
        <HowItWorks />

        {/* Second Ad placement */}
        <AdContainer slotId="content-bottom" />

        {/* FAQ Accordion */}
        <FaqSection />

        {/* Popular Searches & Informational SEO Section */}
        <section className="py-12 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800" aria-label="Popular searches">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-4">
              Popular searches
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {[
                'Facebook video downloader',
                'FB video download',
                'Facebook video download HD',
                'Facebook video to MP3',
                'Facebook reels downloader',
                'Facebook story downloader',
                'Download Facebook video without app',
                'Facebook video downloader for Android',
                'Facebook video downloader for iPhone',
                'Facebook video download kaise kare',
              ].map((term) => (
                <span
                  key={term}
                  className="px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs"
                >
                  {term}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
              ClipFetch is a free online Facebook video downloader. Save Facebook videos, reels and stories in HD 720p or 480p, or convert them to MP3 high quality audio. It works on Android, iPhone and PC with no app and no login.
            </p>
          </div>
        </section>
      </main>

      {/* Global Footer */}
      <Footer
        onNavClick={handleNavClick}
        onOpenModal={(type) => setActiveModal(type)}
      />

      {/* Legal Modals (Privacy, Terms, Copyright) */}
      <LegalModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
}
