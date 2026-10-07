import { generateSecret, generateURI, verify } from "otplib";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: "MUSHIN Admin", label: email, secret });
}

/**
 * Returns the RFC 6238 time step the code matched, or null.
 * Codes at or before `afterTimeStep` (the last step already used) are refused, so a code cannot be replayed.
 */
export async function matchTotp(secret: string, code: string, afterTimeStep: number | null): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const result = await verify({
    secret,
    token: code,
    epochTolerance: 30,
    ...(afterTimeStep === null ? {} : { afterTimeStep }),
  });
  return result.valid && "timeStep" in result ? result.timeStep : null;
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  return (await matchTotp(secret, code, null)) !== null;
}
