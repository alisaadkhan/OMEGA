import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { WebAuthnConfig } from "./webauthn";

/** Relying party used by tests; matches what the app derives from APP_URL=http://localhost:5173. */
export const TEST_WEBAUTHN: WebAuthnConfig = { rpId: "localhost", rpName: "MUSHIN staff", origins: ["http://localhost:5173"] };

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/**
 * A software security key for tests (ES256, "none" attestation): it answers registration and authentication options
 * exactly as a browser would relay a real key's response. Flags: user present and user verified are set unless asked not to.
 */
export function softwareKey(o: { rpId?: string; origin?: string } = {}) {
  const rpId = o.rpId ?? TEST_WEBAUTHN.rpId;
  const origin = o.origin ?? TEST_WEBAUTHN.origins[0] ?? "";
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credentialId = randomBytes(32);
  let counter = 0;
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const clientData = (type: string, challenge: string, originOverride?: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: originOverride ?? origin, crossOrigin: false }));
  const coseKey = (pub: KeyObject) => {
    const jwk = pub.export({ format: "jwk" });
    return isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x ?? "", "base64url")], [-3, Buffer.from(jwk.y ?? "", "base64url")]]));
  };
  return {
    credentialId: b64u(credentialId),
    /** Registration response for `options` (from generateRegistrationOptions). */
    register(options: { challenge: string }, over: { uv?: boolean; origin?: string } = {}) {
      const flags = 0x01 | (over.uv === false ? 0 : 0x04) | 0x40; // UP, UV, AT
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), u32(counter), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, Buffer.from(coseKey(publicKey))]);
      const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64u(clientData("webauthn.create", options.challenge, over.origin)), attestationObject: b64u(attestationObject), transports: ["usb"] },
        clientExtensionResults: {},
      };
    },
    /** Assertion for `options` (from generateAuthenticationOptions); `counterStep: 0` replays the previous counter. */
    assert(options: { challenge: string }, over: { uv?: boolean; origin?: string; counterStep?: number; key?: KeyObject } = {}) {
      counter += over.counterStep ?? 1;
      const flags = 0x01 | (over.uv === false ? 0 : 0x04);
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), u32(counter)]);
      const cd = clientData("webauthn.get", options.challenge, over.origin);
      const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(cd).digest()]), over.key ?? privateKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature) },
        clientExtensionResults: {},
      };
    },
  };
}
