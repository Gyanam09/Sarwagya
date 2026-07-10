import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Sarwagya — Geopolitical Intelligence",
  description: "सर्वज्ञ — All-knowing geopolitical intelligence platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
        <body className="antialiased" style={{ background: '#020408', color: '#e2e8f0' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
