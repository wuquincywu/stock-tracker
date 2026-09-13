import { describe, expect, it } from "vitest";
import { parseNumber, parseStockDayRow, parseT86Row, rocDateToIso } from "./twse";

describe("rocDateToIso", () => {
  it("converts an ROC calendar date to ISO", () => {
    expect(rocDateToIso("115/09/01")).toBe("2026-09-01");
  });

  it("pads single-digit month/day", () => {
    expect(rocDateToIso("113/1/5")).toBe("2024-01-05");
  });
});

describe("parseNumber", () => {
  it("strips thousands separators", () => {
    expect(parseNumber("1,234,567")).toBe(1234567);
  });

  it("handles a plain number string", () => {
    expect(parseNumber("42")).toBe(42);
  });
});

describe("parseStockDayRow", () => {
  it("maps a STOCK_DAY row to a PriceRow using its fixed column positions", () => {
    // Real STOCK_DAY layout: [date, volume, turnover($), open, high, low, close, change, transactions]
    const row = ["115/09/01", "12,345,678", "999,999,999", "580.00", "585.00", "578.00", "582.00", "+2.00", "12,345"];
    expect(parseStockDayRow(row)).toEqual({
      date: "2026-09-01",
      volume: 12345678,
      open: 580,
      high: 585,
      low: 578,
      close: 582,
    });
  });
});

describe("parseT86Row", () => {
  it("maps a T86 row to foreign/trust/dealer net using its fixed column positions", () => {
    // Columns: [0]code [1]name [2-4]外陸資買/賣/買賣超 [5-7]外資自營商買/賣/買賣超 [8-10]投信買/賣/買賣超
    // [11]自營商合計買賣超 ... — see the mapping comment above parseT86Row in lib/twse.ts.
    const row = [
      "2330", " 台積電 ",
      "1000", "500", "500", // 外陸資(不含外資自營商): buy/sell/net
      "300", "100", "200", // 外資自營商: buy/sell/net
      "50", "20", "30", // 投信: buy/sell/net
      "-40", // 自營商合計買賣超
    ];
    expect(parseT86Row(row)).toEqual({
      code: "2330",
      name: "台積電", // trimmed
      foreignNet: 700, // 500 + 200
      investmentTrustNet: 30,
      dealerNet: -40,
    });
  });
});
