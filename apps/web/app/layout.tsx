import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Symphoneer Hub",
  description: "Remote control plane for a local Symphoneer Runtime",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
