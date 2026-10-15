import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PingCode｜账户与信号运营系统",
  description: "以账户与信号驱动增长，管理账户洞察、SDR交付与反馈。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
