import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIAGA · Supply Intelligence Agent",
  description: "Supervised AI agent guarding availability in FMCG supply chains",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Presenter mode is the default; the client drops the class in Planner mode.
  return (
    <html lang="en" className={`presenter h-full antialiased ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
