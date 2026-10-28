import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Overpass and Overpass Mono (OFL, variable weight), bundled in app/fonts so nothing is
// downloaded at build or run time: the demo laptop may be offline.
const overpass = localFont({
  src: [
    { path: "./fonts/overpass-latin-wght-normal.woff2", style: "normal", weight: "100 900" },
    { path: "./fonts/overpass-latin-wght-italic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-overpass",
  display: "swap",
});
const overpassMono = localFont({
  src: [{ path: "./fonts/overpass-mono-latin-wght-normal.woff2", style: "normal", weight: "300 700" }],
  variable: "--font-overpass-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SIAGA · Supply Intelligence Agent",
  description: "Supervised AI agent guarding availability in FMCG supply chains",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Presenter mode is the default; the client drops the class in Planner mode.
  return (
    <html lang="en" className={`presenter h-full antialiased ${overpass.variable} ${overpassMono.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
