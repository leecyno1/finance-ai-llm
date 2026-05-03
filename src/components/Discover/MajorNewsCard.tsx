import { Discover } from '@/app/discover/page';
import Link from 'next/link';
import { buildSummaryHref } from '@/lib/utils/newsSummaryHref';

const getOgFallback = (articleUrl: string) =>
  `/api/og-image?url=${encodeURIComponent(articleUrl)}`;

const getThumbnailSrc = (thumbnail: string | undefined, articleUrl: string) => {
  if (!thumbnail) return getOgFallback(articleUrl);
  try {
    const url = new URL(thumbnail).toString();
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  } catch {
    if (
      thumbnail.startsWith('/api/') ||
      thumbnail.startsWith('/dr-') ||
      thumbnail.startsWith('/mei-')
    ) {
      return thumbnail;
    }
    return getOgFallback(articleUrl);
  }
};

const MajorNewsCard = ({
  item,
  isLeft = true,
}: {
  item: Discover;
  isLeft?: boolean;
}) => (
  <Link
    href={buildSummaryHref(item.url, item.title, item.content)}
    className="w-full group flex flex-row items-stretch gap-6 h-60 py-3"
    target="_blank"
  >
    {isLeft ? (
      <>
        <div className="relative w-80 h-full overflow-hidden rounded-2xl flex-shrink-0">
          <img
            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500 brand-image-highlight"
            src={getThumbnailSrc(item.thumbnail, item.url)}
            alt={item.title}
            onError={(e) => {
              const el = e.currentTarget;
              const state = el.dataset.fallbackApplied || '';
              if (state === 'og') {
                el.src = '/dasheng-logo.png';
                return;
              }
              el.dataset.fallbackApplied = 'og';
              el.src = getOgFallback(item.url);
            }}
          />
        </div>
        <div className="flex flex-col justify-center flex-1 py-4">
          <h2
            className="text-3xl font-light mb-3 leading-tight line-clamp-3 group-hover:text-rose-500 dark:group-hover:text-fuchsia-300 transition duration-200"
            style={{ fontFamily: 'PP Editorial, serif' }}
          >
            {item.title}
          </h2>
          <p className="text-black/60 dark:text-white/60 text-base leading-relaxed line-clamp-4">
            {item.content}
          </p>
        </div>
      </>
    ) : (
      <>
        <div className="flex flex-col justify-center flex-1 py-4">
          <h2
            className="text-3xl font-light mb-3 leading-tight line-clamp-3 group-hover:text-rose-500 dark:group-hover:text-fuchsia-300 transition duration-200"
            style={{ fontFamily: 'PP Editorial, serif' }}
          >
            {item.title}
          </h2>
          <p className="text-black/60 dark:text-white/60 text-base leading-relaxed line-clamp-4">
            {item.content}
          </p>
        </div>
        <div className="relative w-80 h-full overflow-hidden rounded-2xl flex-shrink-0">
          <img
            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500 brand-image-highlight"
            src={getThumbnailSrc(item.thumbnail, item.url)}
            alt={item.title}
            onError={(e) => {
              const el = e.currentTarget;
              const state = el.dataset.fallbackApplied || '';
              if (state === 'og') {
                el.src = '/dasheng-logo.png';
                return;
              }
              el.dataset.fallbackApplied = 'og';
              el.src = getOgFallback(item.url);
            }}
          />
        </div>
      </>
    )}
  </Link>
);

export default MajorNewsCard;
