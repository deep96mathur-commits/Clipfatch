import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: 'Is ClipFetch free to use?',
    answer:
      'Yes, ClipFetch is completely free to use. You can retrieve public video details and download available formats without any subscription fees, user accounts, or hidden charges.',
  },
  {
    question: 'Which content is supported?',
    answer:
      'ClipFetch supports all public Facebook video content, including Facebook Reels, Facebook Watch episodes, Page timeline videos, and fb.watch short links. Only public videos are supported.',
  },
  {
    question: 'Do I need to create an account?',
    answer:
      'No. ClipFetch is an instant utility. You never have to create an account, log in with Facebook, or provide any personal details.',
  },
  {
    question: 'What video qualities can I download?',
    answer:
      'Available qualities depend on the original upload on Facebook. We provide MP4 options up to 1080p Full HD, 720p HD, and 480p SD, as well as MP3 audio extraction.',
  },
  {
    question: 'Can I download private Facebook videos or private groups?',
    answer:
      'No. ClipFetch respects creator privacy and Meta access controls. We do not bypass login requirements, private Facebook profiles, closed Facebook groups, or restricted posts.',
  },
  {
    question: 'Is it legal to download Facebook videos?',
    answer:
      'You should only download Facebook videos that you own, have explicit authorization to download, or that are released under an open public license.',
  },
];

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-16 sm:py-24 bg-slate-100/60 dark:bg-slate-900/50 transition-colors">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wider mb-4">
            FAQ
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
            Have questions about ClipFetch? Find quick answers to common questions below.
          </p>
        </div>

        <div className="space-y-3.5">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-xs transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full py-4.5 px-6 flex items-center justify-between text-left cursor-pointer gap-4 group"
                  aria-expanded={isOpen}
                >
                  <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {faq.question}
                  </span>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-950 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all ${
                      isOpen ? 'rotate-180 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400' : ''
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-700/60">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
