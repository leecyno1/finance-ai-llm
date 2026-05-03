import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '大圣之怒 · AI金融研究',
    short_name: '大圣之怒',
    description:
      '大圣之怒 是面向金融投研的 AI 助手：支持联网检索、财经快讯与宏观数据。',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    screenshots: [
      {
        src: '/screenshots/p1.png',
        form_factor: 'wide',
        sizes: '2560x1600',
      },
      {
        src: '/screenshots/p2.png',
        form_factor: 'wide',
        sizes: '2560x1600',
      },
      {
        src: '/screenshots/p1_small.png',
        form_factor: 'narrow',
        sizes: '828x1792',
      },
      {
        src: '/screenshots/p2_small.png',
        form_factor: 'narrow',
        sizes: '828x1792',
      },
    ],
    icons: [
      {
        src: '/icon-50.png',
        sizes: '50x50',
        type: 'image/png' as const,
      },
      {
        src: '/icon-100.png',
        sizes: '100x100',
        type: 'image/png',
      },
      {
        src: '/icon.png',
        sizes: '440x440',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
