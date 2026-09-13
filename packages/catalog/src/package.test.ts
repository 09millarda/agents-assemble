import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { canonical } from "./definition.ts";
import {
  PACKAGE_LIMITS,
  packageDefinition,
  readStoredArchive,
  verifyPackage,
  writeStoredArchive,
} from "./package.ts";
import { starterPlaybook } from "./starters.ts";

const origin = { installation: "offline-a", organization: "opaque-org", package: "feature" };
const fixture = () => packageDefinition(starterPlaybook("new-feature"), origin);
it("verifies a complete offline closure without hooks, network or grants", () => {
  const bytes = fixture();
  const result = verifyPackage(bytes);
  expect(result.manifest.components.length).toBeGreaterThan(10);
  expect(result.definitions[result.manifest.root]).toEqual(starterPlaybook("new-feature"));
  expect(Object.values(result.attribution).every((value) => value.status === "unverified")).toBe(
    true,
  );
  expect(() => verifyPackage(bytes, [], false)).toThrow(/requires verified/);
});
it("rejects corruption, prefix/trailing data, compression and directory contradictions", () => {
  const bytes = fixture();
  expect(() => verifyPackage(Buffer.concat([Buffer.from("prefix"), bytes]))).toThrow();
  expect(() => verifyPackage(Buffer.concat([bytes, Buffer.from("x")]))).toThrow();
  const method = Buffer.from(bytes);
  method.writeUInt16LE(8, 8);
  expect(() => verifyPackage(method)).toThrow();
  const crc = Buffer.from(bytes);
  crc[40] ^= 1;
  expect(() => verifyPackage(crc)).toThrow();
  expect(() => verifyPackage(Buffer.alloc(PACKAGE_LIMITS.transport + 1))).toThrow(/bounds/);
});
it("rejects noncanonical metadata, missing or extra blobs and invalid signatures", () => {
  const entries = readStoredArchive(fixture());
  const original = entries.get("manifest.json");
  if (!original) throw new Error("Missing fixture manifest");
  entries.set("manifest.json", Buffer.from(`${original.toString()} `));
  expect(() => verifyPackage(writeStoredArchive(entries))).toThrow(/canonical/);
  entries.set("manifest.json", original);
  entries.set(`blobs/${"0".repeat(64)}`, Buffer.from("unlisted"));
  expect(() => verifyPackage(writeStoredArchive(entries))).toThrow(/unlisted/);
});
it("checks independently configured Ed25519 key scope and canonical proof bytes", () => {
  const entries = readStoredArchive(fixture());
  const raw = entries.get("manifest.json");
  if (!raw) throw new Error("Missing fixture manifest");
  const manifest = JSON.parse(raw.toString());
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    Buffer.concat([
      Buffer.from("agents-assemble/package-component/v1\0"),
      Buffer.from(manifest.root, "hex"),
    ]),
    privateKey,
  ).toString("base64");
  manifest.proofs = [{ component: manifest.root, keyId: "publisher", signature }];
  entries.set("manifest.json", Buffer.from(canonical(manifest)));
  const bytes = writeStoredArchive(entries);
  const key = {
    keyId: "publisher",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    installation: origin.installation,
    organization: origin.organization,
  };
  expect(verifyPackage(bytes, [key]).attribution[manifest.root].status).toBe("verified");
  expect(() => verifyPackage(bytes, [{ ...key, organization: "different" }])).toThrow(
    /outside key scope/,
  );
  manifest.proofs[0].signature = signature.replace(/=+$/, "");
  entries.set("manifest.json", Buffer.from(canonical(manifest)));
  expect(() => verifyPackage(writeStoredArchive(entries))).toThrow(/proof/);
});
it("preserves semantic identity across ZIP ordering and timestamp changes", () => {
  const original = fixture(),
    changed = Buffer.from(writeStoredArchive(new Map([...readStoredArchive(original)].reverse())));
  const centralStart = changed.readUInt32LE(changed.length - 6);
  let local = 0,
    central = centralStart;
  for (let n = 0; n < changed.readUInt16LE(changed.length - 12); n++) {
    const nameLength = changed.readUInt16LE(central + 28),
      size = changed.readUInt32LE(central + 24),
      time = (12 << 11) | (34 << 5) | 10,
      date = ((2025 - 1980) << 9) | (6 << 5) | 15;
    changed.writeUInt16LE(time, local + 10);
    changed.writeUInt16LE(date, local + 12);
    changed.writeUInt16LE(time, central + 12);
    changed.writeUInt16LE(date, central + 14);
    local += 30 + nameLength + size;
    central += 46 + nameLength;
  }
  const a = verifyPackage(original),
    b = verifyPackage(changed);
  expect(b.manifest.root).toBe(a.manifest.root);
  expect(b.manifest.closureDigest).toBe(a.manifest.closureDigest);
  expect(b.transportDigest).not.toBe(a.transportDigest);
});
