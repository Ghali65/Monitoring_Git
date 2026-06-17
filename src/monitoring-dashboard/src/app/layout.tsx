import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VulnTracker — Dependency Security Monitor",
  description: "Dashboard de surveillance des vulnérabilités dans les dépendances GitHub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
