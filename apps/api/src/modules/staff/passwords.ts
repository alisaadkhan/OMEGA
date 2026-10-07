import { hash, verify } from "@node-rs/argon2";

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password);
}

let dummy: Promise<string> | undefined;
/** A real hash used to keep timing equal when the email does not exist. */
export function dummyHash(): Promise<string> {
  dummy ??= hash("mushin-timing-equalizer");
  return dummy;
}
