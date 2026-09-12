import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser, getRegisteredUsers } from "@/lib/users";
import PushSetup from "@/components/PushSetup";
import UserPicker from "@/components/UserPicker";
import UserSwitcher from "@/components/UserSwitcher";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "股票追蹤",
  description: "追蹤台股三大法人買賣超、均線突破提醒與布林通道",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  let users: string[] = [];
  let currentUser: string | null = null;
  try {
    users = await getRegisteredUsers();
    currentUser = await getCurrentUser();
  } catch {
    // Redis unreachable — fall through with no confirmed user; UserPicker still works (its "+
    // 新增使用者" form will itself fail until Redis is back, which is the best available signal).
  }

  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            股票追蹤
          </Link>
          {currentUser && (
            <div className="flex items-center gap-4">
              <Link href="/faq" className="text-sm text-zinc-400 hover:text-zinc-100">
                常見問題
              </Link>
              <Link href="/settings" className="text-sm text-zinc-400 hover:text-zinc-100">
                通知設定
              </Link>
              <UserSwitcher name={currentUser} />
            </div>
          )}
        </header>
        <main className="flex-1">{currentUser ? children : <UserPicker users={users} />}</main>
        {currentUser && <PushSetup />}
      </body>
    </html>
  );
}
