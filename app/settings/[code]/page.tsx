import Link from "next/link";
import { notFound } from "next/navigation";
import { lookupStock } from "@/lib/marketdata";
import { getAlertConfig, getStockAlertConfig, isInWatchlist } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import StockAlertConfigClient from "@/components/StockAlertConfigClient";
import BackButton from "@/components/ui/BackButton";

export default async function StockSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  // A per-stock override only means anything for a stock this user actually tracks — see
  // app/api/settings/stock/[code]/route.ts's same check.
  if (!(await isInWatchlist(currentUser, code))) notFound();

  const [info, sharedConfig, override] = await Promise.all([
    lookupStock(code),
    getAlertConfig(currentUser),
    getStockAlertConfig(currentUser, code),
  ]);
  if (!info) notFound();

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold">
          {code} {info.name} 通知設定
        </h1>
        <p className="text-sm text-zinc-500">
          只套用在這一檔股票。想調整所有股票共用的預設值，請到
          <Link href="/settings" className="text-emerald-400 hover:underline">
            通知設定
          </Link>
          。
        </p>
      </div>
      <StockAlertConfigClient code={code} sharedConfig={sharedConfig} initialOverride={override} />
    </div>
  );
}
