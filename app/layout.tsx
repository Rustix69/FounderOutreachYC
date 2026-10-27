import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "YC Founder Outreach",
  description: "Pick a YC batch, find founder emails, and write personalised cold emails from one template.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={dmSans.variable}><body>{children}</body></html>;
}
