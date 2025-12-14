'use client';

import Image from 'next/image';

const DrLemonBrand = ({ className = '' }: { className?: string }) => {
  return (
    <div
      className={`flex items-center gap-3 ${className}`}
      aria-label="Dr.Lemon"
    >
      <div className="flex items-center justify-center rounded-full bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500 p-[3px] shadow-sm shadow-yellow-300/50">
        <div className="rounded-full bg-light-primary dark:bg-dark-primary p-[3px]">
          <Image
            src="/dr-lemon-logo.svg"
            alt="Dr.Lemon logo"
            width={40}
            height={40}
            className="rounded-full"
          />
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-200 bg-clip-text text-transparent">
          Dr.Lemon
        </span>
        <span className="mt-1 text-[11px] uppercase tracking-[0.18em] text-black/50 dark:text-white/45">
          ECONOMIC&nbsp;INTEL&nbsp;ASSISTANT
        </span>
      </div>
    </div>
  );
};

export default DrLemonBrand;
