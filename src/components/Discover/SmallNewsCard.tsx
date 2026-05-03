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

const SmallNewsCard = ({ item }: { item: Discover }) => (
  <Link
    href={buildSummaryHref(item.url, item.title, item.content)}
    className="rounded-3xl overflow-hidden bg-light-secondary dark:bg-dark-secondary shadow-sm shadow-light-200/10 dark:shadow-black/25 group flex flex-col"
    target="_blank"
  >
    <div className="relative aspect-video overflow-hidden">
      <img
        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300 brand-image-highlight"
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
    <div className="p-4">
      <h3 className="font-semibold text-sm mb-2 leading-tight line-clamp-2 group-hover:text-rose-500 dark:group-hover:text-fuchsia-300 transition duration-200">
        {item.title}
      </h3>
      <p className="text-black/60 dark:text-white/60 text-xs leading-relaxed line-clamp-2">
        {item.content}
      </p>
    </div>
  </Link>
);

export default SmallNewsCard;
