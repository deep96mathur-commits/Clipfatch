import React from 'react';
import { Play } from 'lucide-react';
import { ModalType } from '../types/index.ts';

interface FooterProps {
  onNavClick: (sectionId: string) => void;
  onOpenModal: (type: ModalType) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavClick, onOpenModal }) => {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 pb-10 border-b border-slate-100 dark:border-slate-800/80">
          {/* Brand */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Play className="w-4 h-4 fill-white ml-0.5" />
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Clip<span className="text-blue-600 dark:text-blue-400">Fetch</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
              Download Facebook Videos & Reels. Fast, secure, and clean utility for public Facebook media retrieval.
            </p>
          </div>

          {/* Quick Nav */}
          <div className="flex flex-wrap items-center gap-6 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400">
            <button
              onClick={() => onNavClick('home')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              Home
            </button>
            <button
              onClick={() => onNavClick('how-it-works')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              How It Works
            </button>
            <button
              onClick={() => onNavClick('platforms')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              Supported Platforms
            </button>
            <button
              onClick={() => onNavClick('faq')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              FAQ
            </button>
          </div>

          {/* Legal Links */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <button
              onClick={() => onOpenModal('privacy')}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            <span>·</span>
            <button
              onClick={() => onOpenModal('terms')}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              Terms of Service
            </button>
            <span>·</span>
            <button
              onClick={() => onOpenModal('copyright')}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              DMCA Contact
            </button>
          </div>
        </div>

        {/* Disclaimer & Copyright */}
        <div className="pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-slate-400 dark:text-slate-500">
          <p className="max-w-3xl leading-relaxed">
            ClipFetch is an independent educational and utility tool and is not affiliated with, endorsed by, or sponsored by Meta or Facebook. All brand marks and trademarks belong to their respective owners. ClipFetch does not host any copyrighted media.
          </p>
          <p className="shrink-0">
            © {new Date().getFullYear()} ClipFetch. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
