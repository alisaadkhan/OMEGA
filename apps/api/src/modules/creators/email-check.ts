import { promises as dns } from "node:dns";

/**
 * Email checks for contact availability (migration 0032). Only what can be established without sending anything: the
 * address is well formed, and its domain exists and publishes where to deliver mail. A passing check never proves that
 * the inbox exists or that a message would be delivered; nothing here connects to a mail server or sends a message.
 */

/** Domains reserved for documentation and testing (RFC 2606, RFC 6761) or placeholders people type into bios. */
const RESERVED_DOMAINS = /^(?:example\.(?:com|net|org)|(?:[a-z0-9-]+\.)*(?:example|test|invalid|localhost|local))$/;
/** File names that look like addresses in bios ("logo@2x.png"). */
const FILE_LIKE = /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|pdf)$/;

/**
 * A usable email: local part 1–64 characters of letters, digits and ._%+- without leading, trailing or doubled dots;
 * domain of letter/digit labels (inner hyphens allowed) with an alphabetic top-level label; not a reserved or
 * file-like domain. Anything else is not stored as a contact, so it is never shown as available.
 */
export function isUsableEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length > 254) return false;
  const at = v.lastIndexOf("@");
  if (at < 1 || at !== v.indexOf("@")) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length > 64 || !/^[a-z0-9._%+-]+$/.test(local) || /^\.|\.$|\.\./.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false;
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1] ?? "")) return false;
  return !RESERVED_DOMAINS.test(domain) && !FILE_LIKE.test(domain);
}

export type MailResolver = {
  /** MX records of the domain; rejects with a DNS error code (ENOTFOUND, ENODATA, ETIMEOUT …). */
  mx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  /** Whether the domain has an IPv4 or IPv6 address (the implicit mail host when there is no MX, RFC 5321 §5.1). */
  hasAddress(domain: string): Promise<boolean>;
};

export type EmailCheck = { result: "domain_ok" | "invalid" | "check_failed"; detail: string };

const codeOf = (err: unknown): string => (err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "");
/** DNS answers that mean "this name has no such records"; anything else (timeouts, refused, server failures) is unknown. */
const NO_RECORDS = new Set(["ENODATA", "ENOTFOUND"]);

/** Format, then domain: exists, publishes MX (or an address), and does not declare "no mail" with a null MX. */
export async function checkEmail(value: string, resolver: MailResolver): Promise<EmailCheck> {
  if (!isUsableEmail(value)) return { result: "invalid", detail: "malformed_or_reserved" };
  const domain = value.trim().toLowerCase().slice(value.trim().indexOf("@") + 1);
  try {
    const records = await resolver.mx(domain);
    const hosts = records.map((r) => r.exchange.replace(/\.$/, "")).filter(Boolean);
    if (records.length > 0 && hosts.length === 0) return { result: "invalid", detail: "null_mx" };
    if (hosts.length > 0) return { result: "domain_ok", detail: "mx_found" };
  } catch (err) {
    if (codeOf(err) === "ENOTFOUND") return { result: "invalid", detail: "no_such_domain" };
    if (!NO_RECORDS.has(codeOf(err))) return failed(err);
  }
  // No MX: mail goes to the domain's own address, if it has one.
  try {
    return (await resolver.hasAddress(domain)) ? { result: "domain_ok", detail: "address_record_only" } : { result: "invalid", detail: "no_mail_host" };
  } catch (err) {
    if (codeOf(err) === "ENOTFOUND") return { result: "invalid", detail: "no_such_domain" };
    return codeOf(err) === "ENODATA" ? { result: "invalid", detail: "no_mail_host" } : failed(err);
  }
}

const failed = (err: unknown): EmailCheck => ({ result: "check_failed", detail: `dns_${codeOf(err).toLowerCase() || "error"}` });

/** The system resolver with a time limit; DNS lookups are free and send nothing to the address itself. */
export function systemMailResolver(timeoutMs = 5_000): MailResolver {
  const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 2 });
  const any = async (lookups: Promise<string[]>[]) => (await Promise.allSettled(lookups)).some((r) => r.status === "fulfilled" && r.value.length > 0);
  return {
    mx: (domain) => resolver.resolveMx(domain),
    async hasAddress(domain) {
      const four = resolver.resolve4(domain);
      const six = resolver.resolve6(domain);
      if (await any([four, six])) return true;
      // Both failed: a missing name rejects with ENOTFOUND, which the caller reads as "no such domain".
      await four;
      return false;
    },
  };
}
