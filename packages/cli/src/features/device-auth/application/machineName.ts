import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

const MACHINE_NAME_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_MACHINE_NAME_LENGTH = 60;

export interface MachineNameDependencies {
  envValue?: string;
  readHostname?: () => string;
  randomSuffix?: () => string;
}

export function generateMachineNameSuffix(randomBytesImpl: (size: number) => Buffer = randomBytes): string {
  const bytes = randomBytesImpl(4);
  let suffix = "";
  for (const byte of bytes) suffix += MACHINE_NAME_SUFFIX_ALPHABET[byte % MACHINE_NAME_SUFFIX_ALPHABET.length];
  return suffix;
}

export function sanitizeHostnameForMachineName(rawHostname: string): string {
  const sanitized = rawHostname
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized === "" ? "machine" : sanitized;
}

export function generateMachineName(dependencies: { readHostname?: () => string; randomSuffix?: () => string } = {}): string {
  let rawHostname = "";
  try {
    rawHostname = dependencies.readHostname ? dependencies.readHostname() : hostname();
  } catch {
    rawHostname = "";
  }
  const base = sanitizeHostnameForMachineName(rawHostname ?? "");
  const suffix = dependencies.randomSuffix ? dependencies.randomSuffix() : generateMachineNameSuffix();
  const maxBaseLength = MAX_MACHINE_NAME_LENGTH - suffix.length - 1;
  const trimmedBase = base.slice(0, Math.max(1, maxBaseLength)).replace(/-+$/g, "") || "machine";
  return `${trimmedBase}-${suffix}`;
}

export function resolveMachineName(explicit?: string, dependencies: MachineNameDependencies = {}): string {
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  const envValue = dependencies.envValue ?? process.env.FACTORY_MACHINE_NAME;
  if (envValue !== undefined && envValue.trim() !== "") return envValue;
  return generateMachineName(dependencies);
}
