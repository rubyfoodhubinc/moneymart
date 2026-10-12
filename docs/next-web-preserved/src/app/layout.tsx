import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SiteFooter, SiteHeader, MobileTabBar } from '@/components/site-shell';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: {
    default: 'MoneyMart — Bid. Stream. Win.',
    template: '%s · MoneyMart',
  },
  description:
    'MoneyMart is the hybrid live-commerce and auction platform: creator-led live auctions, traditional auction house sales, and a verified secondary marketplace across Nigeria, the USA, the UK and Canada.',
  applicationName: 'MoneyMart',
  keywords: [
    'live auctions',
    'creator live shopping',
    'online auction house',
    'secondary marketplace',
    'MoneyMart',
  ],
  openGraph: {
    title: 'MoneyMart — Bid. Stream. Win.',
    description: 'Live creator auctions, traditional auction house sales, and a verified marketplace.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0D1B2A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <Providers>
          <SiteHeader />
          <main className="min-h-[70vh] pb-24 md:pb-0">{children}</main>
          <SiteFooter />
          <MobileTabBar />
        </Providers>
      </body>
    </html>
  );
}
