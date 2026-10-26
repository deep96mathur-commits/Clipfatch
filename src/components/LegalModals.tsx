import React from 'react';
import { X, Shield, FileText, Scale } from 'lucide-react';
import { ModalType } from '../types/index.ts';

interface LegalModalsProps {
  activeModal: ModalType;
  onClose: () => void;
}

export const LegalModals: React.FC<LegalModalsProps> = ({ activeModal, onClose }) => {
  if (!activeModal) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            {activeModal === 'privacy' && <Shield className="w-5 h-5 text-blue-600" />}
            {activeModal === 'terms' && <FileText className="w-5 h-5 text-blue-600" />}
            {activeModal === 'copyright' && <Scale className="w-5 h-5 text-blue-600" />}
            <h2 className="text-lg font-bold text-slate-900 dark:text-white capitalize">
              {activeModal === 'privacy' && 'Privacy Policy'}
              {activeModal === 'terms' && 'Terms of Service'}
              {activeModal === 'copyright' && 'Copyright & DMCA Notice'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {activeModal === 'privacy' && (
            <>
              <p>
                <strong>Last Updated: October 2026</strong>
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                1. No Account or Personal Data Collection
              </h3>
              <p>
                ClipFetch is designed with privacy by default. We do not require account registration, passwords, social logins, or personal details to use the service.
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                2. Ephemeral Media Processing
              </h3>
              <p>
                ClipFetch does not store, host, or archive downloaded videos permanently. When you initiate a download, data is piped ephemerally directly from the source content delivery network to your browser and never retained on ClipFetch servers.
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                3. Server Logs and Security
              </h3>
              <p>
                We maintain minimal, temporary operational logs strictly for rate limiting, abuse prevention, and SSRF security defense. These logs are purged automatically.
              </p>
            </>
          )}

          {activeModal === 'terms' && (
            <>
              <p>
                <strong>Last Updated: October 2026</strong>
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                1. Acceptance of Terms
              </h3>
              <p>
                By accessing or using ClipFetch, you agree to comply with and be bound by these Terms of Service. If you do not agree, do not use the application.
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                2. Permitted Use and Authorization
              </h3>
              <p>
                ClipFetch is intended solely for personal, non-commercial use with publicly accessible videos that you have legal rights or explicit permission to download. You may not use ClipFetch to download copyrighted media without authorization from the copyright owner.
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                3. Technical Limitations and Disclaimers
              </h3>
              <p>
                ClipFetch does not guarantee 100% video retrieval uptime. Platform API changes, private account settings, or regional restrictions may cause video fetching to be unavailable.
              </p>
            </>
          )}

          {activeModal === 'copyright' && (
            <>
              <p>
                <strong>Digital Millennium Copyright Act (DMCA) & Takedown Policy</strong>
              </p>
              <p>
                ClipFetch respects the intellectual property rights of creators and content owners. ClipFetch does not host or store any video files on its servers. All media streamed through the service is fetched directly from the third-party platforms.
              </p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-4">
                Filing a Takedown Request
              </h3>
              <p>
                If you are a copyright owner or an authorized agent and believe that a URL accessible through our tool infringes your copyright, please send a notice containing:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <li>Identification of the copyrighted work claimed to have been infringed.</li>
                <li>The exact URL of the material on the third-party platform.</li>
                <li>Your contact information (name, address, email address, telephone number).</li>
                <li>A statement of good faith belief that the use is unauthorized.</li>
                <li>A statement made under penalty of perjury that the information is accurate.</li>
              </ul>
              <p className="mt-3">
                Send DMCA takedown requests to: <strong>dmca@clipfetch.app</strong>
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};
