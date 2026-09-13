import { describe, expect, it } from "vitest";
import { parseNumber, parseTpexInstitutionalRow } from "./tpex";

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
