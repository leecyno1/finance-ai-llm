'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIDEBAR_LOGO_SRC = '/dasheng-logo.png';
const HEADER_BRAND_SRC = '/dasheng-brand-header.png';

type BrandLogoMode = 'nav' | 'home' | 'sidebar';

const BrandLogo = ({
  className = '',
  mode = 'nav',
}: {
  className?: string;
  mode?: BrandLogoMode;
}) => {
  const isHome = mode === 'home';
  const isSidebar = mode === 'sidebar';

  if (isSidebar) {
    return (
      <div
        className={cn('inline-flex items-center gap-0', className)}
        aria-label="大圣之怒品牌标识"
      >
        <div className="relative h-9 w-9 shrink-0 overflow-hidden">
          <Image
            src={SIDEBAR_LOGO_SRC}
            alt="大圣之怒 logo"
            width={5315}
            height={6379}
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center',
        isHome ? 'h-16 gap-2.5' : 'h-10 gap-1.5 xl:gap-2',
        className,
      )}
      aria-label="大圣之怒品牌标识"
    >
      <div
        className={cn(
          'relative shrink-0',
          isHome ? 'h-14 w-[170px] sm:w-[190px]' : 'h-9 w-[120px] xl:w-[132px]',
        )}
      >
        <Image
          src={HEADER_BRAND_SRC}
          alt="大圣之怒品牌"
          width={9535}
          height={3178}
          className="h-full w-full object-contain"
          priority={isHome}
        />
      </div>
      <span
        className={cn(
          'whitespace-nowrap font-black text-[#0d3f99] leading-none',
          isHome ? 'text-[1.2rem] sm:text-[1.35rem]' : 'text-[0.9rem] xl:text-[1rem]',
        )}
        style={{
          fontFamily:
            '"YouYuan", "STYuanti-SC-Regular", "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        FinAgent
      </span>
    </div>
  );
};

export default BrandLogo;
