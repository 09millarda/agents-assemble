import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import {
  actionSchema,
  canonical,
  type Definition,
  DefinitionError,
  digest,
  validateDefinition,
  validateSchema,
} from "./definition.ts";
import { starterPlaybook } from "./starters.ts";

export const PACKAGE_LIMITS = {
  transport: 4 * 1024 * 1024,
  entries: 64,
  member: 512 * 1024,
  manifest: 256 * 1024,
  components: 32,
  files: 32,
  depth: 32,
  nodes: 20000,
  string: 65536,
  path: 160,
  proofs: 32,
} as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const originSchema = z.strictObject({
  installation: z.string().min(1).max(160),
  organization: z.string().min(1).max(160),
  package: z.string().min(1).max(160),
});
const logicalPath = z
  .string()
  .max(PACKAGE_LIMITS.path)
  .regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/)
  .refine((path) => !path.split("/").some((part) => part === "." || part === ".."));
export const descriptorSchema = z.strictObject({
  origin: originSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  kind: z.enum(["playbook", "action", "schema", "skill", "resource"]),
  schema: z.string().min(1).max(160),
  entrypoint: logicalPath,
  files: z
    .array(
      z.strictObject({
        path: logicalPath,
        digest: hashSchema,
        size: z.number().int().min(0).max(PACKAGE_LIMITS.member),
      }),
    )
    .min(1)
    .max(PACKAGE_LIMITS.files),
  dependencies: z.array(hashSchema).max(PACKAGE_LIMITS.components),
  runtimeSlots: z.array(z.string().min(1).max(160)).max(100),
  permissions: z.array(z.string().min(1).max(160)).max(100),
  terms: z.strictObject({
    license: z.string().min(1).max(160),
    redistribution: z.literal("permitted"),
    noticePaths: z.array(logicalPath).min(1).max(32),
  }),
  provenance: z
    .array(
      z.strictObject({
        origin: originSchema,
        version: z.string().min(1).max(80),
        digest: hashSchema,
      }),
    )
    .max(32),
  changelog: z.string().max(16000),
});
export type ComponentDescriptor = z.infer<typeof descriptorSchema>;
export const exportRightsSchema = z
  .array(
    z.strictObject({
      componentId: z.string().min(1).max(160),
      license: z.string().min(1).max(160),
      redistribution: z.literal("permitted"),
      noticeText: z.string().min(1).max(65536),
    }),
  )
  .min(1)
  .max(32);
export type ExportRights = z.infer<typeof exportRightsSchema>;
export const packageManifestSchema = z.strictObject({
  formatVersion: z.literal("aa-package/1"),
  root: hashSchema,
  closureDigest: hashSchema,
  components: z
    .array(z.strictObject({ digest: hashSchema, descriptor: descriptorSchema }))
    .min(1)
    .max(PACKAGE_LIMITS.components),
  proofs: z
    .array(
      z.strictObject({
        component: hashSchema,
        keyId: z.string().min(1).max(160),
        signature: z.string().max(128),
      }),
    )
    .max(PACKAGE_LIMITS.proofs),
});
export type PackageManifest = z.infer<typeof packageManifestSchema>;
export type TrustKey = {
  keyId: string;
  publicKey: string;
  installation: string;
  organization: string;
};
export type VerifiedPackage = {
  manifest: PackageManifest;
  blobs: Map<string, Buffer>;
  transportDigest: string;
  attribution: Record<string, { status: "verified" | "unverified"; keyId?: string }>;
  definitions: Record<string, Definition>;
};
const fail = (code: string, message: string): never => {
  throw new DefinitionError(code, message);
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function metadata(bytes: Buffer): unknown {
  if (bytes.length > PACKAGE_LIMITS.manifest) fail("package_limit", "Manifest exceeds 256 KiB");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > PACKAGE_LIMITS.depth) fail("package_limit", "Metadata nesting exceeds 32");
    } else if (char === "}" || char === "]") depth--;
  }
  const value: unknown = JSON.parse(text);
  let nodes = 0;
  const inspect = (item: unknown): void => {
    if (++nodes > PACKAGE_LIMITS.nodes) fail("package_limit", "Metadata node budget exceeded");
    if (typeof item === "number" && !Number.isSafeInteger(item))
      fail("noncanonical_metadata", "Metadata numbers must be safe integers");
    if (
      typeof item === "string" &&
      (Buffer.byteLength(item) > PACKAGE_LIMITS.string ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item))
    )
      fail("noncanonical_metadata", "Invalid or oversized Unicode metadata string");
    if (item && typeof item === "object")
      for (const [key, child] of Object.entries(item)) {
        if (!Array.isArray(item) && !/^[\x20-\x7e]*$/.test(key))
          fail("noncanonical_metadata", "Metadata keys must be ASCII");
        inspect(child);
      }
  };
  inspect(value);
  if (canonical(value) !== text)
    fail(
      "noncanonical_metadata",
      "Manifest bytes must be canonical; duplicates, whitespace and numeric aliases are rejected",
    );
  return value;
}

/** Read only the aa-package/1 stored profile. No archive member is ever extracted. */
export function readStoredArchive(input: Uint8Array): Map<string, Buffer> {
  if (input.byteLength > PACKAGE_LIMITS.transport || input.byteLength < 22)
    fail("package_limit", "Package transport exceeds bounds");
  const bytes = Buffer.from(input);
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 20) !== 0
  )
    fail("invalid_archive", "Expected one final, uncommented ZIP directory");
  const entries = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (
    !entries ||
    entries > PACKAGE_LIMITS.entries ||
    bytes.readUInt16LE(end + 8) !== entries ||
    centralOffset + centralSize !== end
  )
    fail("invalid_archive", "Invalid ZIP directory bounds");
  const result = new Map<string, Buffer>();
  let central = centralOffset;
  let local = 0;
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (
      central + 46 > end ||
      bytes.readUInt32LE(central) !== 0x02014b50 ||
      local + 30 > centralOffset ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      fail("invalid_archive", "Missing contiguous ZIP header");
    const nameLength = bytes.readUInt16LE(central + 28);
    const size = bytes.readUInt32LE(central + 24);
    const crc = bytes.readUInt32LE(central + 16);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const dataOffset = local + 30 + localNameLength;
    if (
      size > PACKAGE_LIMITS.member ||
      total + size > PACKAGE_LIMITS.transport ||
      central + 46 + nameLength > end ||
      dataOffset + size > centralOffset
    )
      fail("package_limit", "ZIP member exceeds bounds");
    // Version 20, DOS creator, zero flags/method/extras/comments/attributes. Timestamps are transport metadata.
    const zeroCentral = [8, 10, 30, 32, 34, 36];
    const time = bytes.readUInt16LE(central + 12),
      date = bytes.readUInt16LE(central + 14),
      year = 1980 + (date >>> 9),
      month = (date >>> 5) & 15,
      day = date & 31;
    if (
      time >>> 11 > 23 ||
      ((time >>> 5) & 63) > 59 ||
      (time & 31) > 29 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    )
      fail("invalid_archive", "Invalid DOS timestamp");
    if (
      bytes.readUInt16LE(central + 4) !== 20 ||
      bytes.readUInt16LE(central + 6) !== 20 ||
      zeroCentral.some((offset) => bytes.readUInt16LE(central + offset) !== 0) ||
      bytes.readUInt32LE(central + 38) !== 0 ||
      bytes.readUInt32LE(central + 42) !== local ||
      bytes.readUInt32LE(central + 20) !== size
    )
      fail("invalid_archive", "Unsupported central ZIP metadata");
    if (
      bytes.readUInt16LE(local + 4) !== 20 ||
      bytes.readUInt16LE(local + 6) !== 0 ||
      bytes.readUInt16LE(local + 8) !== 0 ||
      bytes.readUInt16LE(local + 10) !== time ||
      bytes.readUInt16LE(local + 12) !== date ||
      bytes.readUInt32LE(local + 14) !== crc ||
      bytes.readUInt32LE(local + 18) !== size ||
      bytes.readUInt32LE(local + 22) !== size ||
      localNameLength !== nameLength ||
      bytes.readUInt16LE(local + 28) !== 0
    )
      fail("invalid_archive", "Contradictory or unsupported local ZIP metadata");
    const nameBytes = bytes.subarray(central + 46, central + 46 + nameLength);
    if (!bytes.subarray(local + 30, dataOffset).equals(nameBytes))
      fail("invalid_archive", "ZIP names disagree");
    const name = nameBytes.toString("ascii");
    if (
      !nameBytes.equals(Buffer.from(name, "ascii")) ||
      !/^(?:manifest\.json|blobs\/[a-f0-9]{64})$/.test(name) ||
      result.has(name)
    )
      fail("invalid_archive", "Unsupported or duplicate ZIP path");
    const content = bytes.subarray(dataOffset, dataOffset + size);
    if (crc32(content) !== crc) fail("invalid_archive", "ZIP CRC mismatch");
    result.set(name, content);
    local = dataOffset + size;
    central += 46 + nameLength;
    total += size;
  }
  if (local !== centralOffset || central !== end || !result.has("manifest.json"))
    fail("invalid_archive", "ZIP contains gaps, extra data or a missing manifest");
  return result;
}
export function writeStoredArchive(entries: Map<string, Buffer>): Buffer {
  if (entries.size > PACKAGE_LIMITS.entries || !entries.has("manifest.json"))
    fail("package_limit", "Invalid entry count or missing manifest");
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    if (
      !/^(?:manifest\.json|blobs\/[a-f0-9]{64})$/.test(name) ||
      content.length > PACKAGE_LIMITS.member
    )
      fail("invalid_archive", "Invalid stored entry");
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    const central = Buffer.alloc(46);
    const crc = crc32(content);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, content);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...locals, directory, end]);
  if (archive.length > PACKAGE_LIMITS.transport) fail("package_limit", "Package exceeds 4 MiB");
  return archive;
}
export function verifyPackage(
  bytes: Uint8Array,
  trust: TrustKey[] = [],
  allowUnverified = true,
): VerifiedPackage {
  const entries = readStoredArchive(bytes);
  const manifest = packageManifestSchema.parse(metadata(entries.get("manifest.json") as Buffer));
  const components = new Map(
    manifest.components.map((component) => [component.digest, component.descriptor]),
  );
  if (
    components.size !== manifest.components.length ||
    !components.has(manifest.root) ||
    canonical(manifest.components.map((component) => component.digest)) !==
      canonical([...components.keys()].sort())
  )
    fail("closure_error", "Components must be unique, sorted and include the root");
  if (
    digest({ root: manifest.root, components: [...components.keys()].sort() }) !==
    manifest.closureDigest
  )
    fail("digest_mismatch", "Closure digest mismatch");
  const seenOrigins = new Map<string, string>();
  const usedBlobs = new Set<string>();
  const blobs = new Map<string, Buffer>();
  const definitions: Record<string, Definition> = {};
  const actions = new Map<string, unknown>();
  for (const [componentDigest, descriptor] of components) {
    if (digest(descriptor) !== componentDigest)
      fail("digest_mismatch", "Component descriptor digest mismatch");
    const identity = canonical({ origin: descriptor.origin, version: descriptor.version });
    if (seenOrigins.has(identity) && seenOrigins.get(identity) !== componentDigest)
      fail("origin_conflict", "One immutable origin/version binds different components");
    seenOrigins.set(identity, componentDigest);
    const paths = descriptor.files.map((file) => file.path);
    if (
      new Set(paths).size !== paths.length ||
      canonical(paths) !== canonical([...paths].sort()) ||
      !paths.includes(descriptor.entrypoint) ||
      descriptor.terms.noticePaths.some((path) => !paths.includes(path))
    )
      fail("inventory_error", "Files must be sorted, unique and include entrypoint and notices");
    if (
      new Set(descriptor.dependencies).size !== descriptor.dependencies.length ||
      canonical(descriptor.dependencies) !== canonical([...descriptor.dependencies].sort()) ||
      descriptor.dependencies.some((dependency) => !components.has(dependency))
    )
      fail("closure_error", "Dependencies must be exact, sorted and present");
    for (const file of descriptor.files) {
      const blob = entries.get(`blobs/${file.digest}`);
      if (!blob || blob.length !== file.size || sha(blob) !== file.digest)
        fail("digest_mismatch", "Missing or mismatched inventory blob");
      usedBlobs.add(`blobs/${file.digest}`);
      blobs.set(file.digest, blob as Buffer);
    }
    const entry = descriptor.files.find((file) => file.path === descriptor.entrypoint);
    const content = blobs.get(entry?.digest ?? "") as Buffer;
    if (descriptor.kind === "playbook") {
      if (descriptor.schema !== "agents-assemble.playbook/1")
        fail("unsupported_schema", "Unsupported playbook component schema");
      const definition = validateDefinition(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
      );
      if (
        canonical(definition.permissions.slice().sort()) !==
          canonical(descriptor.permissions.slice().sort()) ||
        canonical(Object.keys(definition.runtimeSlots).sort()) !==
          canonical(descriptor.runtimeSlots.slice().sort())
      )
        fail("capability_mismatch", "Descriptor cannot omit or change behavioral requirements");
      definitions[componentDigest] = definition;
    } else if (descriptor.kind === "action") {
      if (descriptor.schema !== "agents-assemble.action/1")
        fail("unsupported_schema", "Unsupported action component schema");
      const action = actionSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
      );
      const { digest: claimed, ...contract } = action;
      if (digest(contract) !== claimed) fail("digest_mismatch", "Action contract digest mismatch");
      validateSchema(action.inputs);
      validateSchema(action.outputs);
      actions.set(componentDigest, action);
    } else if (descriptor.kind === "schema") {
      if (descriptor.schema !== "https://json-schema.org/draft/2020-12/schema")
        fail("unsupported_schema", "Unsupported schema component");
      validateSchema(JSON.parse(content.toString("utf8")));
    } else if (descriptor.schema !== "agents-assemble.resource/1")
      fail("unsupported_schema", "Unsupported passive component schema");
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) fail("closure_error", "Recursive dependencies are unsupported");
    if (visited.has(key)) return;
    active.add(key);
    for (const dependency of components.get(key)?.dependencies ?? []) visit(dependency);
    active.delete(key);
    visited.add(key);
  };
  visit(manifest.root);
  if (visited.size !== components.size || entries.size !== usedBlobs.size + 1)
    fail("closure_error", "Unreachable components or unlisted blobs are forbidden");
  for (const [key, definition] of Object.entries(definitions))
    for (const action of Object.values(definition.dependencies))
      if (
        !(components.get(key)?.dependencies ?? []).some(
          (dependency) =>
            (actions.get(dependency) as { digest?: string } | undefined)?.digest === action.digest,
        )
      )
        fail("closure_error", "Playbook action closure is incomplete");
  const attribution: VerifiedPackage["attribution"] = Object.fromEntries(
    [...components.keys()].map((key) => [key, { status: "unverified" as const }]),
  );
  const proofIdentities = new Set<string>();
  for (const proof of manifest.proofs) {
    const component = components.get(proof.component);
    const signature = Buffer.from(proof.signature, "base64");
    const identity = canonical(proof);
    if (
      !component ||
      signature.length !== 64 ||
      signature.toString("base64") !== proof.signature ||
      proofIdentities.has(identity)
    )
      fail("invalid_proof", "Invalid or duplicate portable proof");
    proofIdentities.add(identity);
    const key = trust.find((key) => key.keyId === proof.keyId);
    if (!key) continue;
    if (
      key.installation !== component?.origin.installation ||
      key.organization !== component?.origin.organization ||
      !verify(
        null,
        Buffer.concat([
          Buffer.from("agents-assemble/package-component/v1\0"),
          Buffer.from(proof.component, "hex"),
        ]),
        createPublicKey(key.publicKey),
        signature,
      )
    )
      fail("invalid_proof", "Recognized publisher proof is invalid or outside key scope");
    attribution[proof.component] = { status: "verified", keyId: proof.keyId };
  }
  if (!allowUnverified && Object.values(attribution).some((value) => value.status === "unverified"))
    fail("unverified_publisher", "Local import policy requires verified publishers");
  return { manifest, blobs, transportDigest: sha(bytes), attribution, definitions };
}
export function exportPackage(
  manifest: PackageManifest,
  blobs: Map<string, Buffer>,
  trust: TrustKey[] = [],
): Buffer {
  const selected = new Map<string, PackageManifest["proofs"][number]>();
  for (const proof of [...manifest.proofs].sort((a, b) => a.keyId.localeCompare(b.keyId))) {
    if (selected.has(proof.component)) continue;
    const descriptor = manifest.components.find(
      (component) => component.digest === proof.component,
    )?.descriptor;
    const key = trust.find((key) => key.keyId === proof.keyId);
    if (
      !descriptor ||
      !key ||
      key.installation !== descriptor.origin.installation ||
      key.organization !== descriptor.origin.organization
    )
      continue;
    try {
      if (
        verify(
          null,
          Buffer.concat([
            Buffer.from("agents-assemble/package-component/v1\0"),
            Buffer.from(proof.component, "hex"),
          ]),
          createPublicKey(key.publicKey),
          Buffer.from(proof.signature, "base64"),
        )
      )
        selected.set(proof.component, proof);
    } catch {
      /* Invalid historical evidence remains local. */
    }
  }
  const portable = {
    ...manifest,
    proofs: [...selected.values()].sort((a, b) => a.component.localeCompare(b.component)),
  };
  const entries = new Map<string, Buffer>([["manifest.json", Buffer.from(canonical(portable))]]);
  for (const [key, blob] of [...blobs.entries()].sort(([a], [b]) => a.localeCompare(b)))
    entries.set(`blobs/${key}`, blob);
  const bytes = writeStoredArchive(entries);
  verifyPackage(bytes, trust);
  return bytes;
}
/** Export only a validated definition and its explicit action contracts, never a workspace. */
export function packageDefinition(
  value: unknown,
  origin: ComponentDescriptor["origin"],
  suppliedRights?: ExportRights,
  ancestry: ComponentDescriptor["provenance"] = [],
): Buffer {
  const definition = validateDefinition(value);
  const blobs = new Map<string, Buffer>();
  const components: PackageManifest["components"] = [];
  const ids = [
    definition.package.id,
    ...Object.values(definition.dependencies).map((action) => action.id),
  ];
  const builtin = (["new-feature", "bug-fix"] as const).some(
    (kind) => digest(starterPlaybook(kind)) === digest(definition),
  );
  const rights =
    suppliedRights ??
    (builtin
      ? ids.map((componentId) => ({
          componentId,
          license: "Apache-2.0",
          redistribution: "permitted" as const,
          noticeText:
            "Copyright Agents Assemble contributors. Licensed under Apache-2.0. https://www.apache.org/licenses/LICENSE-2.0\n",
        }))
      : []);
  if (
    rights.length !== ids.length ||
    new Set(rights.map((item) => item.componentId)).size !== rights.length ||
    ids.some((id) => !rights.some((item) => item.componentId === id))
  )
    fail(
      "redistribution_review_required",
      "Explicit rights and notices must cover every selected component exactly once",
    );
  exportRightsSchema.parse(rights);
  const add = (
    content: unknown,
    kind: "action" | "playbook",
    sourceId: string,
    name: string,
    version: string,
    dependencies: string[],
    requirements: string[],
    slots: string[],
  ) => {
    const terms = rights.find((item) => item.componentId === sourceId);
    if (!terms)
      throw new DefinitionError(
        "rights_required",
        "Explicit component redistribution terms are required",
      );
    const notice = Buffer.from(terms.noticeText);
    const noticeDigest = sha(notice);
    blobs.set(noticeDigest, notice);
    const bytes = Buffer.from(canonical(content));
    const contentDigest = sha(bytes);
    blobs.set(contentDigest, bytes);
    const descriptor: ComponentDescriptor = {
      origin: { ...origin, package: name },
      version,
      kind,
      schema: `agents-assemble.${kind}/1`,
      entrypoint: "definition.json",
      files: [
        { path: "definition.json", digest: contentDigest, size: bytes.length },
        { path: "notice.txt", digest: noticeDigest, size: notice.length },
      ],
      dependencies: dependencies.sort(),
      runtimeSlots: slots.sort(),
      permissions: requirements.slice().sort(),
      terms: { license: terms.license, redistribution: "permitted", noticePaths: ["notice.txt"] },
      provenance: kind === "playbook" ? ancestry : [],
      changelog: "Initial portable release",
    };
    const component = { digest: digest(descriptor), descriptor };
    components.push(component);
    return component.digest;
  };
  const dependencies = Object.entries(definition.dependencies).map(([alias, action]) =>
    add(
      action,
      "action",
      action.id,
      `${origin.package}/${alias}`,
      action.version,
      [],
      action.permissions,
      [],
    ),
  );
  const root = add(
    definition,
    "playbook",
    definition.package.id,
    origin.package,
    definition.package.version,
    dependencies,
    definition.permissions,
    Object.keys(definition.runtimeSlots),
  );
  components.sort((a, b) => a.digest.localeCompare(b.digest));
  return exportPackage(
    {
      formatVersion: "aa-package/1",
      root,
      components,
      closureDigest: digest({ root, components: components.map((component) => component.digest) }),
      proofs: [],
    },
    blobs,
  );
}
