import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steam Desk — database-backed Steam catalog',
  description: 'Explore and analyze 139,556 Steam games with database-backed genres, tags, reviews, ownership, pricing, and playtime.',
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'https://release-desk-calendar.ahenselin.chatgpt.site'),
  openGraph: {
    title: 'Steam Desk — database-backed Steam catalog',
    description: 'Explore and analyze 139,556 Steam games with database-backed genres, tags, reviews, ownership, pricing, and playtime.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Steam Desk data dashboard.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Steam Desk — database-backed Steam catalog',
    description: 'Explore and analyze 139,556 Steam games with database-backed genres, tags, reviews, ownership, pricing, and playtime.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
