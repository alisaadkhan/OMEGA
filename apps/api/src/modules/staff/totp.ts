import { generateSecret, generateURI, verify } from "otplib";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: "MUSHIN Admin", label: email, secret });
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  return result.valid;
}
