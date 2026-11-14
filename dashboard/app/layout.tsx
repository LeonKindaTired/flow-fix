import type { ReactNode } from "react";
import './globals.css';

export const viewport = { themeColor: '#151412' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

