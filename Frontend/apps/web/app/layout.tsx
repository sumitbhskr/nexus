import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'NEXUS — Enterprise Decision Intelligence',
    template: '%s | NEXUS',
  },
  description:
    'Enterprise Decision Intelligence & Autonomous Workflow Platform. Forward Deployed Engineering at scale.',
  keywords: ['enterprise', 'AI', 'operations', 'workflow', 'automation', 'copilot'],
  authors: [{ name: 'NEXUS Team' }],
  robots: { index: false, follow: false },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased nexus-dark`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}