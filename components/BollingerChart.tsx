"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { BollingerPoint, InstitutionalRow, PriceRow } from "@/lib/types";

const INSTITUTIONAL_SCALE_ID = "institutional";

export default function BollingerChart({
  prices,
  bands,
  institutional,
}: {
  prices: PriceRow[];
  bands: BollingerPoint[];
  institutional: InstitutionalRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      timeScale: { borderColor: "#3f3f46" },
      rightPriceScale: { borderColor: "#3f3f46", scaleMargins: { top: 0.1, bottom: 0.28 } },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#f87171",
      downColor: "#34d399",
      borderVisible: false,
      wickUpColor: "#f87171",
      wickDownColor: "#34d399",
    });
    candleSeries.setData(
      prices.map((p) => ({ time: p.date, open: p.open, high: p.high, low: p.low, close: p.close })),
    );

    const upperSeries = chart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 1 });
    upperSeries.setData(
      bands.filter((b) => b.upper !== null).map((b) => ({ time: b.date, value: b.upper as number })),
    );

    const middleSeries = chart.addSeries(LineSeries, { color: "#a1a1aa", lineWidth: 1 });
    middleSeries.setData(
      bands.filter((b) => b.middle !== null).map((b) => ({ time: b.date, value: b.middle as number })),
    );

    const lowerSeries = chart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 1 });
    lowerSeries.setData(
      bands.filter((b) => b.lower !== null).map((b) => ({ time: b.date, value: b.lower as number })),
    );

    // 三大法人合計買賣超 histogram, pinned to the bottom ~22% of the panel as its own price scale
    // sharing the candlestick's time axis — 買(net>0) 紅色在基準之上, 賣(net<0) 綠色在基準之下.
    const institutionalSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: INSTITUTIONAL_SCALE_ID,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale(INSTITUTIONAL_SCALE_ID).applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    });
    institutionalSeries.setData(
      institutional.map((row) => {
        const net = row.foreignNet + row.investmentTrustNet + row.dealerNet;
        return { time: row.date, value: net, color: net >= 0 ? "#f87171" : "#34d399" };
      }),
    );

    chart.timeScale().fitContent();

    const handleResize = () => chart.applyOptions({ width: container.clientWidth });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [prices, bands, institutional]);

  return <div ref={containerRef} className="w-full overflow-hidden rounded-lg border border-zinc-800" />;
}
