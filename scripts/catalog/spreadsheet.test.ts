import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toCsv, toXlsx } from "./spreadsheet";

/** Reads the entries of a stored/deflated ZIP through its central directory. */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26);
    out.set(name, inflateRawSync(buf.subarray(start, start + size)).toString("utf8"));
    at += 46 + nameLength;
  }
  return out;
}

describe("owner export spreadsheets", () => {
  it("writes CSV with quoting and never lets a creator's text become a formula", () => {
    const csv = toCsv(["Name", "Followers"], [["=HYPERLINK(\"http://x\")", 12], ["Sana, Lahore", null], ["-1 trick", 3]]).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",12`);
    expect(csv).toContain(`"Sana, Lahore",`);
    expect(csv).toContain("'-1 trick,3");
  });

  it("writes a valid XLSX package: text as inline strings, numbers as numbers, control characters removed", () => {
    const files = unzip(toXlsx("Qualified Creators", ["Name", "Followers"], [["=1+1 <b>&", 25_600_000], ["Bad\u0001Name", null]]));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=1+1 &lt;b&gt;&amp;</t></is></c><c r="B2"><v>25600000</v></c>');
    expect(sheet).toContain(">BadName<");
    expect(sheet).not.toContain("<f>");
    expect(files.get("xl/workbook.xml")).toContain('name="Qualified Creators"');
  });
});
