import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Friendboxd — Movie picks from your friends',
  description:
    'Enter your Letterboxd username and get movie recommendations tuned to what your friends have watched and loved.',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      {/* suppressHydrationWarning: VS Code's Simple Browser injects a
          `vsc-initialized` class onto <body> after server render, which
          otherwise triggers a harmless hydration mismatch warning. */}
      <body
        className="min-h-screen bg-base-950 text-zinc-100 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}