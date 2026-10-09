import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIAGA · Supply Intelligence Agent",
  description: "Supervised AI agent guarding availability in FMCG supply chains",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
