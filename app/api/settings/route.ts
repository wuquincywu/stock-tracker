import { NextRequest, NextResponse } from "next/server";
import { getAlertConfig, getChartMonths, setAlertConfig, setChartMonths } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import { ALL_MA_ALERT_KEYS, INSTITUTIONAL_CATEGORY_ORDER } from "@/lib/types";
import type { AlertConfig, InstitutionalCategory, InstitutionalLevel, MaAlertKey } from "@/lib/types";

const ALL_LEVELS: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [config, chartMonths] = await Promise.all([getAlertConfig(currentUser), getChartMonths(currentUser)]);
  return NextResponse.json({ config, chartMonths });
}

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as Partial<AlertConfig> & { chartMonths?: number };
  const levels = Array.isArray(body.levels) ? body.levels.filter((l) => ALL_LEVELS.includes(l)) : [];
  const streakThresholds: Record<InstitutionalCategory, number> = { foreign: 0, trust: 0, dealer: 0, combined: 0 };
  for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
    const value = body.streakThresholds?.[category];
    streakThresholds[category] = Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
  }
  const maAlerts: MaAlertKey[] = Array.isArray(body.maAlerts)
    ? body.maAlerts.filter((k): k is MaAlertKey => ALL_MA_ALERT_KEYS.includes(k))
    : [];

  const config: AlertConfig = { levels, streakThresholds, maAlerts };
  await setAlertConfig(currentUser, config);

  let chartMonths: number | undefined;
  if (Number.isFinite(body.chartMonths)) {
    await setChartMonths(currentUser, body.chartMonths!);
    chartMonths = await getChartMonths(currentUser);
  }

  return NextResponse.json({ config, chartMonths });
}
