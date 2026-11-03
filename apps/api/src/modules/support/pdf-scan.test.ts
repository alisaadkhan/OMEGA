import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfScanText, topLevelDict } from "./pdf-scan";

const pdf = (...objs: (string | Buffer)[]) => new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n"), ...objs.map((o) => (typeof o === "string" ? Buffer.from(o) : o)), Buffer.from("\n%%EOF")]));
const stream = (dict: string, data: Buffer | string) => Buffer.concat([Buffer.from(`1 0 obj ${dict}\nstream\n`), Buffer.from(data), Buffer.from("\nendstream\nendobj\n")]);
const hiddenJs = deflateSync(Buffer.from("<< /S /JavaScript /JS (app.alert(1)) >>"));

describe("PDF scan text (attachment scan hook)", () => {
  it("reads only top-level keys and refuses comments and repeated keys", () => {
    expect(topLevelDict("<< /Type /XObject /DecodeParms << /Filter /Decoy >> /Filter /DCTDecode >>")?.get("Filter")).toBe("/DCTDecode");
    expect(topLevelDict("<< /Filter /FlateDecode /Filter /DCTDecode >>")).toBeNull();
    expect(topLevelDict("<< /Filter /DCTDecode % /Filter /FlateDecode\n /Length 4 >>")).toBeNull();
    const d = topLevelDict("<< /Title (a \\) >> /Filter) /Length 3 0 R >>");
    expect(d?.get("Length")).toBe("3 0 R");
    expect(d?.has("Filter")).toBe(false);
  });

  it("inflates object streams and finds what they hide; normal files pass", () => {
    expect(pdfScanText(pdf(stream(`<< /Type /ObjStm /N 1 /First 0 /Filter /FlateDecode /Length ${hiddenJs.length} >>`, hiddenJs)))).toContain("/JavaScript");
    const content = deflateSync(Buffer.from("BT /F1 12 Tf (Invoice 42) Tj ET"));
    const text = pdfScanText(pdf(stream(`<< /Length ${content.length} /Filter /FlateDecode >>`, content), stream("<< /Type /XRef /Filter /FlateDecode /DecodeParms << /Columns 5 /Predictor 12 >> /Length 4 >>", "AAAA")));
    expect(text).toContain("Invoice 42");
    expect(text).not.toContain("JavaScript");
  });

  it("reads ASCII85 and hex chains the way a reader does, so hidden content is found", () => {
    const a85 = (b: Buffer) => {
      let out = "";
      for (let i = 0; i < b.length; i += 4) {
        const chunk = Buffer.concat([b.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4);
        let n = chunk.readUInt32BE(0);
        const digits: string[] = [];
        for (let k = 0; k < 5; k++) { digits.unshift(String.fromCharCode((n % 85) + 33)); n = Math.floor(n / 85); }
        out += digits.join("").slice(0, Math.min(4, b.length - i) + 1);
      }
      return `${out}~>`;
    };
    expect(pdfScanText(pdf(stream("<< /Type /ObjStm /Filter [/ASCII85Decode /FlateDecode] /Length 9 >>", a85(hiddenJs))))).toContain("/JavaScript");
    expect(pdfScanText(pdf(stream("<< /Filter /ASCIIHexDecode /Length 9 >>", `${Buffer.from("/OpenAction").toString("hex")}>`)))).toContain("/OpenAction");
  });

  it("refuses what it cannot check: indirect or unknown filters, chains, predictors on object streams, codecs off images, encryption", () => {
    expect(pdfScanText(pdf(stream("<< /Filter 5 0 R /Length 4 >>", "AAAA")))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Filter [/ASCII85Decode /FlateDecode] /Length 4 >>", "AAAA")))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Filter /LZWDecode /Length 4 >>", "AAAA")))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Filter /ASCIIHexDecode /Length 4 >>", "ZZZZ")))).toBeNull();
    expect(pdfScanText(pdf(stream(`<< /Type /ObjStm /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length ${hiddenJs.length} >>`, hiddenJs)))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Type /ObjStm /Filter /DCTDecode /Length 4 >>", "AAAA")))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Filter /DCTDecode /Length 4 >>", "AAAA")))).toBeNull();
    expect(pdfScanText(pdf(stream("<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length 4 >>", "AAAA")))).not.toBeNull();
    expect(pdfScanText(pdf("trailer << /Encr#79pt 3 0 R >>"))).toBeNull();
  });
});
