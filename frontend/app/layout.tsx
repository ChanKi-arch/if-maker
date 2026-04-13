import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IF Maker — Virtual Lab",
  description:
    "Open-source structured virtual lab. Search, analyze, and mix materials and objects to generate new concepts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
