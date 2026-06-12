import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "오토사장 | AutoCEO Milestone",
  description: "텍스트만 입력하면 내 얼굴과 목소리로 릴스 영상을 만드는 SNS 자동화 SaaS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
