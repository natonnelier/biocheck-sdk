import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { extractMrzLines, otsuThreshold, parseMrz, stripGeometry } from "../src/modules/mrz.js";

// ICAO 9303 specimens.
const TD1 = [
  "I<UTOD231458907<<<<<<<<<<<<<<<",
  "7408122F1204159UTO<<<<<<<<<<<6",
  "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
];
const TD3 = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
  "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
];

describe("extractMrzLines", () => {
  it("strips whitespace, drops noise lines and trims to the exact length", () => {
    const text = `ARGENTINA\n ${TD1[0].slice(0, 15)} ${TD1[0].slice(15)}\n${TD1[1]}<<\n${TD1[2]}\n`;
    expect(extractMrzLines(text)).toEqual({ format: "TD1", lines: TD1 });
  });

  it("identifies TD3 by 2 × 44", () => {
    expect(extractMrzLines(TD3.join("\n"))?.format).toBe("TD3");
  });

  it("returns null when lines are too short", () => {
    expect(extractMrzLines("ABC\nDEF\nGHI")).toBeNull();
  });
});

describe("parseMrz", () => {
  it("accepts a TD1 DNI with valid check digits", () => {
    expect(parseMrz(TD1.join("\n"), "dni")?.format).toBe("TD1");
  });

  it("accepts a TD3 passport", () => {
    expect(parseMrz(TD3.join("\n"), "passport")?.format).toBe("TD3");
  });

  it("rejects a format that does not match the document type", () => {
    expect(parseMrz(TD3.join("\n"), "dni")).toBeNull();
    expect(parseMrz(TD1.join("\n"), "passport")).toBeNull();
  });

  it("autocorrects O→0 in numeric fields", () => {
    const ocr = [TD1[0], TD1[1].replace("7408122", "74O8122"), TD1[2]].join("\n");
    expect(parseMrz(ocr, "dni")).not.toBeNull();
  });

  it("rejects a wrong check digit", () => {
    const bad = [TD1[0], TD1[1].replace("7408122", "7408123"), TD1[2]].join("\n");
    expect(parseMrz(bad, "dni")).toBeNull();
  });

  it("rejects a wrong composite check digit only", () => {
    const bad = [TD1[0], TD1[1].slice(0, 29) + "7", TD1[2]].join("\n");
    expect(parseMrz(bad, "dni")).toBeNull();
  });
});

describe("stripGeometry", () => {
  const doc = DEFAULT_CONFIG.document;

  it("upscales a small capture into the 30–40 px range", () => {
    const g = stripGeometry(300, "dni", doc); // 640-wide frame, card ≈ 300 px tall
    expect(g.sy + g.sh).toBe(300);
    const scaled = g.charHeight * g.scale;
    expect(scaled).toBeGreaterThanOrEqual(30);
    expect(scaled).toBeLessThanOrEqual(40);
    expect(g.scale).toBeGreaterThan(1);
  });

  it("leaves a capture already in range untouched", () => {
    const g = stripGeometry(780, "dni", doc); // ≈ 34.7 px characters
    expect(g.scale).toBe(1);
  });

  it("downscales very large captures", () => {
    expect(stripGeometry(3000, "passport", doc).scale).toBeLessThan(1);
  });
});

describe("otsuThreshold", () => {
  it("separates a bimodal histogram", () => {
    const px = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) px[i] = i < 300 ? 20 + (i % 10) : 200 + (i % 20);
    const t = otsuThreshold(px);
    expect(t).toBeGreaterThanOrEqual(29);
    expect(t).toBeLessThan(200);
  });
});
