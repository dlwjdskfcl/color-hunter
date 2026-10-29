import type { Metadata, Viewport } from 'next';
import { Black_Han_Sans } from 'next/font/google';
import { ServiceWorker } from '@/components/ServiceWorker';
import { BASE_PATH } from '@/lib/config';
import './globals.css';

const display = Black_Han_Sans({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-display-face',
});

export const metadata: Metadata = {
  title: 'Color Hunter · 컬러 헌터',
  description: '제시된 색을 주변에서 찾아 스마트폰으로 찍는 팀 대항 파티 게임. 설치 없이 QR로 바로 참가.',
  applicationName: 'Color Hunter',
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [{ url: `${BASE_PATH}/icon-192.png`, sizes: '192x192', type: 'image/png' }],
    apple: [{ url: `${BASE_PATH}/apple-touch-icon.png`, sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'Color Hunter', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFF7EA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={display.variable}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
