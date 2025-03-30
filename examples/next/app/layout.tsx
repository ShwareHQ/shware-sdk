import './globals.css';
import UnifiedAnalytics from './unified-analytics';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
      <UnifiedAnalytics />
    </html>
  );
}
