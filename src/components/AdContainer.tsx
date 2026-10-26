import React from 'react';

interface AdContainerProps {
  slotId?: string;
  className?: string;
}

export const AdContainer: React.FC<AdContainerProps> = ({ className = '' }) => {
  return (
    <div
      className={`max-w-4xl mx-auto px-4 my-8 ${className}`}
      aria-label="Advertisement Container"
    >
      <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-center flex flex-col items-center justify-center min-h-[90px]">
        <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500 mb-1">
          Advertisement Space
        </span>
        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm">
          Prepared for Google AdSense integration. Ads are non-intrusive and separate from download buttons.
        </p>
      </div>
    </div>
  );
};
