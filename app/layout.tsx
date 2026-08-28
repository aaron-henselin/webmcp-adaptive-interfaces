import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steam Desk — database-backed Steam catalog',
  description: 'Compare two WebMCP patterns for Steam data: a focused report library and a local drag-and-drop page builder.',
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'https://release-desk-calendar.ahenselin.chatgpt.site'),
  openGraph: {
    title: 'Steam Desk — database-backed Steam catalog',
    description: 'Compare two WebMCP patterns for Steam data: a focused report library and a local drag-and-drop page builder.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Steam Desk data dashboard.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Steam Desk — database-backed Steam catalog',
    description: 'Compare two WebMCP patterns for Steam data: a focused report library and a local drag-and-drop page builder.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
