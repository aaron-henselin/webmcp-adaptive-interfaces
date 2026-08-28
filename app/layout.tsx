import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steam Desk — SteamSpy market snapshot',
  description: 'Explore 20,000 Steam games from a locally cached 21-page SteamSpy snapshot.',
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'https://release-desk-calendar.ahenselin.chatgpt.site'),
  openGraph: {
    title: 'Steam Desk — SteamSpy market snapshot',
    description: 'Explore 20,000 Steam games from a locally cached 21-page SteamSpy snapshot.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Steam Desk data dashboard.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Steam Desk — SteamSpy market snapshot',
    description: 'Explore 20,000 Steam games from a locally cached 21-page SteamSpy snapshot.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
