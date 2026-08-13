import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import { TOOL_GROUPS } from "@/lib/tools";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "小工具箱", template: "%s - 小工具箱" },
  description: "在线小工具集合：批量 IP 端口测试等。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <AppShell groups={TOOL_GROUPS}>{children}</AppShell>
      </body>
    </html>
  );
}