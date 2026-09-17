import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface StoredCredentials {
  daemonId: string;
  authToken: string;
  factoryApiUrl: string;
}

export function credentialsFilePath(): string {
  return process.env.FACTORY_CREDENTIALS_PATH ?? join(homedir(), ".factory", "credentials.json");
}

export function saveDaemonCredentials(credentials: StoredCredentials): void {
  mkdirSync(dirname(credentialsFilePath()), { recursive: true });
  writeFileSync(credentialsFilePath(), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function loadDaemonCredentials(): StoredCredentials | null {
  const path = credentialsFilePath();
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredCredentials>;
  if (!parsed.daemonId || !parsed.authToken || !parsed.factoryApiUrl) return null;
  return { daemonId: parsed.daemonId, authToken: parsed.authToken, factoryApiUrl: parsed.factoryApiUrl };
}

export function clearDaemonCredentials(): boolean {
  const path = credentialsFilePath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
