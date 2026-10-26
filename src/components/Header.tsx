import React, { useState } from 'react';
import { Play, Menu, X, ArrowRight } from 'lucide-react';

interface HeaderProps {
  onNavClick: (sectionId: string) => void;
  onFocusInput: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNavClick,
  onFocusInput,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (id: string) => {
    onNavClick(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/95 border-b border-slate-200/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-8">
        {/* Brand Zone */}
        <button
          onClick={() => handleLinkClick('home')}
          className="flex items-center gap-2.5 text-left group cursor-pointer shrink-0"
          aria-label="ClipFetch Home"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Clip<span className="text-blue-600">Fetch</span>
          </span>
        </button>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <button
            onClick={() => handleLinkClick('home')}
            className="hover:text-blue-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            Home
          </button>
          <button
            onClick={() => handleLinkClick('how-it-works')}
            className="hover:text-blue-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            How It Works
          </button>
          <button
            onClick={() => handleLinkClick('platforms')}
            className="hover:text-blue-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            Supported Platforms
          </button>
          <button
            onClick={() => handleLinkClick('faq')}
            className="hover:text-blue-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            FAQ
          </button>
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Primary CTA */}
          <button
            onClick={onFocusInput}
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/25 transition-all cursor-pointer whitespace-nowrap active:scale-95"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3">
          <button
            onClick={() => handleLinkClick('home')}
            className="block w-full text-left py-2.5 px-3 rounded-lg text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            Home
          </button>
          <button
            onClick={() => handleLinkClick('how-it-works')}
            className="block w-full text-left py-2.5 px-3 rounded-lg text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            How It Works
          </button>
          <button
            onClick={() => handleLinkClick('platforms')}
            className="block w-full text-left py-2.5 px-3 rounded-lg text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            Supported Platforms
          </button>
          <button
            onClick={() => handleLinkClick('faq')}
            className="block w-full text-left py-2.5 px-3 rounded-lg text-base font-medium text-slate-700 hover:bg-slate-100"
          >
            FAQ
          </button>
          <div className="pt-2">
            <button
              onClick={() => {
                onFocusInput();
                setMobileMenuOpen(false);
              }}
              className="w-full py-3 px-4 rounded-xl text-center font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition-colors"
            >
              Paste Video Link
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
