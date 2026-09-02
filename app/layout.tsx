import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Adaptive Interfaces — browser-native WebMCP demos',
  description: 'Explore three WebMCP demos that adapt familiar interfaces to user intent, context, and conversation.',
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'https://adaptive-interfaces.ahenselin.chatgpt.site'),
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    title: 'Adaptive Interfaces — browser-native WebMCP demos',
    description: 'Explore three WebMCP demos that adapt familiar interfaces to user intent, context, and conversation.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Adaptive Interfaces demo dashboard.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Adaptive Interfaces — browser-native WebMCP demos',
    description: 'Explore three WebMCP demos that adapt familiar interfaces to user intent, context, and conversation.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
