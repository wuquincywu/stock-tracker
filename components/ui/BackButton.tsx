"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="mb-3 flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"
    >
      <span aria-hidden>←</span> 返回上一頁
    </button>
  );
}
