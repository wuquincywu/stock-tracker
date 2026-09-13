import { describe, expect, it } from "vitest";
import { parseEmergingQuoteRow, parseNumber, parseTpexInstitutionalRow } from "./tpex";

describe("parseNumber", () => {
  it("strips thousands separators", () => {
    expect(parseNumber("1,234,567")).toBe(1234567);
  });
});

describe("parseTpexInstitutionalRow", () => {
  it("maps a row to foreign/trust/dealer net using its fixed column positions", () => {
    const row = Array.from({ length: 23 }, () => "0");
    row[0] = "6488";
    row[1] = "環球晶";
    row[10] = "1500"; // 外資合計買賣超
    row[13] = "-200"; // 投信買賣超
    row[22] = "50"; // 自營商合計買賣超
    expect(parseTpexInstitutionalRow(row)).toEqual({
      code: "6488",
      name: "環球晶",
      foreignNet: 1500,
      investmentTrustNet: -200,
      dealerNet: 50,
    });
  });
});

describe("parseEmergingQuoteRow", () => {
  it("maps a real 興櫃股票當日行情表 row, converting the date and using Average as the open stand-in", () => {
    // Real row, 1260 (富味鄉), 2026-09-11 snapshot.
    const row = {
      Date: "1150911",
      SecuritiesCompanyCode: "1260",
      CompanyName: "富味鄉",
      Highest: "31.45",
      Lowest: "30",
      Average: "30.27",
      LatestPrice: "31.45",
      TransactionVolume: "183197",
    };
    expect(parseEmergingQuoteRow(row)).toEqual({
      code: "1260",
      name: "富味鄉",
      price: { date: "2026-09-11", open: 30.27, high: 31.45, low: 30, close: 31.45, volume: 183197 },
    });
  });

  it("returns null for a stock with no trade that day (empty LatestPrice)", () => {
    const row = {
      Date: "1150911",
      SecuritiesCompanyCode: "9999",
      CompanyName: "無成交",
      Highest: "",
      Lowest: "",
      Average: "",
      LatestPrice: "",
      TransactionVolume: "",
    };
    expect(parseEmergingQuoteRow(row)).toBeNull();
  });
});
