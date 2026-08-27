import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steam Desk — Steam release calendar',
  description: 'Explore thousands of upcoming game releases and visualize the calendar with WebMCP.',
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'https://release-desk-calendar.ahenselin.chatgpt.site'),
  openGraph: {
    title: 'Steam Desk — Steam release calendar',
    description: 'Explore thousands of upcoming game releases and visualize the calendar with WebMCP.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Steam Desk — A Steam release calendar built for agents.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Steam Desk — Steam release calendar',
    description: 'Explore thousands of upcoming game releases and visualize the calendar with WebMCP.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
