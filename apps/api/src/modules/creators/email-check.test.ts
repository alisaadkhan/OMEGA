import { describe, expect, it } from "vitest";
import { checkEmail, isUsableEmail, type MailResolver } from "./email-check";

const dnsError = (code: string) => Object.assign(new Error(code), { code });
function resolver(o: { mx?: { exchange: string; priority: number }[] | string; address?: boolean | string }): MailResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async mx(domain) {
      calls.push(`mx:${domain}`);
      if (typeof o.mx === "string") throw dnsError(o.mx);
      return o.mx ?? [];
    },
    async hasAddress(domain) {
      calls.push(`a:${domain}`);
      if (typeof o.address === "string") throw dnsError(o.address);
      return o.address ?? false;
    },
  };
}

describe("usable email", () => {
  it("accepts ordinary addresses from bios and business fields", () => {
    for (const ok of ["collabs@sana.pk", "hello.world+brands@gmail.com", "Ali_Khan@Yahoo.CO.UK", "team@my-brand.com.pk"]) expect(isUsableEmail(ok)).toBe(true);
  });

  it("rejects malformed, reserved, placeholder and file-like strings", () => {
    for (const bad of ["", "no-at-sign", "a@b", "@gmail.com", ".a@gmail.com", "a.@gmail.com", "a..b@gmail.com", "a@@gmail.com", "a@-bad.com", "a@gmail.c0m", "me@example.com", "x@shop.test", "logo@2x.png", "a@localhost", "you@site.invalid", `${"a".repeat(65)}@gmail.com`])
      expect(isUsableEmail(bad), bad).toBe(false);
  });
});

describe("email check (format, domain, MX; never sends anything)", () => {
  it("a domain with mail servers passes as domain_ok, which is still not proof the inbox exists", async () => {
    expect(await checkEmail("collabs@sana.pk", resolver({ mx: [{ exchange: "mx.sana.pk", priority: 10 }] }))).toEqual({ result: "domain_ok", detail: "mx_found" });
  });

  it("a malformed address is invalid without any DNS lookup", async () => {
    const r = resolver({});
    expect(await checkEmail("logo@2x.png", r)).toEqual({ result: "invalid", detail: "malformed_or_reserved" });
    expect(r.calls).toEqual([]);
  });

  it("a domain that does not exist is invalid", async () => {
    expect(await checkEmail("a@no-such-domain-xyz.pk", resolver({ mx: "ENOTFOUND" }))).toEqual({ result: "invalid", detail: "no_such_domain" });
  });

  it("a null MX (RFC 7505) means the domain accepts no mail", async () => {
    expect(await checkEmail("a@nomail.pk", resolver({ mx: [{ exchange: "", priority: 0 }] }))).toEqual({ result: "invalid", detail: "null_mx" });
    expect(await checkEmail("a@nomail.pk", resolver({ mx: [{ exchange: ".", priority: 0 }] }))).toEqual({ result: "invalid", detail: "null_mx" });
  });

  it("without MX, the domain's own address is the mail host; without either the address cannot work", async () => {
    expect(await checkEmail("a@small.pk", resolver({ mx: "ENODATA", address: true }))).toEqual({ result: "domain_ok", detail: "address_record_only" });
    expect(await checkEmail("a@small.pk", resolver({ mx: "ENODATA", address: false }))).toEqual({ result: "invalid", detail: "no_mail_host" });
    expect(await checkEmail("a@small.pk", resolver({ mx: "ENODATA", address: "ENODATA" }))).toEqual({ result: "invalid", detail: "no_mail_host" });
  });

  it("DNS trouble is recorded as a failed check, never as invalid", async () => {
    expect(await checkEmail("a@sana.pk", resolver({ mx: "ETIMEOUT" }))).toEqual({ result: "check_failed", detail: "dns_etimeout" });
    expect(await checkEmail("a@sana.pk", resolver({ mx: "ENODATA", address: "ESERVFAIL" }))).toEqual({ result: "check_failed", detail: "dns_eservfail" });
  });
});
