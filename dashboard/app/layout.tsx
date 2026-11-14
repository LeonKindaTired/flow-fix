import type { ReactNode } from "react";
import './globals.css';

export const viewport = { themeColor: '#0A0A0A' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

