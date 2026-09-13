import { execFile } from "node:child_process";
import { createPublicKey, randomBytes, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { dirname, join } from "node:path";
import type { TLSSocket } from "node:tls";
import { promisify } from "node:util";
import type { Hono } from "hono";

const exec = promisify(execFile);
export type RunnerPeer = {
  fingerprint256: string;
  organizationId: string;
  runnerId: string;
  authorized: true;
};
export class RunnerCertificateAuthority {
  readonly directory: string;
  constructor(stateDirectory: string) {
    this.directory = join(stateDirectory, "runner-pki");
  }
  async initialize(hostname = "localhost"): Promise<void> {
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) throw new Error("invalid_tls_hostname");
    await mkdir(dirname(this.directory), { recursive: true, mode: 0o700 });
    if (!existsSync(this.directory)) {
      const work = await mkdtemp(join(dirname(this.directory), ".runner-pki-generation-"));
      try {
        const candidate = new RunnerCertificateAuthority(work);
        await candidate.initializeFresh(hostname);
        // The complete protected identity is published in one rename. A concurrent
        // API/worker either wins or uses the winner; no reader sees partial keys.
        try {
          await rename(candidate.directory, this.directory);
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
            throw error;
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0)
      throw new Error("runner_pki_directory_permissions");
    for (const name of ["ca-key.pem", "ca.pem", "server-key.pem", "server.pem", "enrollment-key"]) {
      const file = await lstat(join(this.directory, name));
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        (name !== "ca.pem" && name !== "server.pem" && (file.mode & 0o077) !== 0)
      )
        throw new Error("runner_pki_file_permissions");
    }
    const ca = new X509Certificate(await this.caPem()),
      server = new X509Certificate(await readFile(join(this.directory, "server.pem")));
    const caKey = createPublicKey(await readFile(join(this.directory, "ca-key.pem"))).export({
        format: "der",
        type: "spki",
      }),
      serverKey = createPublicKey(await readFile(join(this.directory, "server-key.pem"))).export({
        format: "der",
        type: "spki",
      });
    if (
      !ca.publicKey.export({ format: "der", type: "spki" }).equals(caKey) ||
      !server.publicKey.export({ format: "der", type: "spki" }).equals(serverKey) ||
      !server.verify(ca.publicKey)
    )
      throw new Error("runner_pki_identity_mismatch");
  }
  private async initializeFresh(hostname: string): Promise<void> {
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) throw new Error("invalid_tls_hostname");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const key = join(this.directory, "ca-key.pem"),
      cert = join(this.directory, "ca.pem");
    if (existsSync(key) !== existsSync(cert)) throw new Error("runner_ca_incomplete");
    if (!existsSync(key)) {
      await exec("openssl", [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "3650",
        "-subj",
        "/CN=Agents Assemble Runner Authority",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ]);
      await chmod(key, 0o600);
    }
    if (((await stat(key)).mode & 0o077) !== 0) throw new Error("runner_ca_key_permissions");
    const secret = join(this.directory, "enrollment-key");
    if (!existsSync(secret)) await writeFile(secret, randomBytes(32), { mode: 0o600, flag: "wx" });
    const serverKey = join(this.directory, "server-key.pem"),
      serverCert = join(this.directory, "server.pem");
    if (existsSync(serverKey) !== existsSync(serverCert))
      throw new Error("runner_server_identity_incomplete");
    if (!existsSync(serverKey)) {
      const csr = join(this.directory, "server.csr.pem"),
        extension = join(this.directory, "server-extensions.cnf");
      await exec("openssl", [
        "req",
        "-new",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        serverKey,
        "-out",
        csr,
        "-subj",
        `/CN=${hostname}`,
      ]);
      await chmod(serverKey, 0o600);
      await writeFile(
        extension,
        `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname},IP:127.0.0.1,IP:::1\n`,
        { mode: 0o600 },
      );
      await exec("openssl", [
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        cert,
        "-CAkey",
        key,
        "-set_serial",
        `0x${randomBytes(16).toString("hex")}`,
        "-out",
        serverCert,
        "-days",
        "365",
        "-extfile",
        extension,
      ]);
    }
  }
  async enrollmentKey(): Promise<Buffer> {
    return readFile(join(this.directory, "enrollment-key"));
  }
  async caPem(): Promise<string> {
    return readFile(join(this.directory, "ca.pem"), "utf8");
  }
  async sign(
    csrPem: string,
    runnerId: string,
    organizationId: string,
  ): Promise<{
    certificatePem: string;
    fingerprint256: string;
    expiresAt: string;
    publicKeyDigest: string;
  }> {
    if (!/^[a-f0-9-]{36}$/.test(runnerId) || !/^[a-f0-9-]{36}$/.test(organizationId))
      throw new Error("invalid_certificate_scope");
    const work = await mkdtemp(join(this.directory, "issuance-"));
    try {
      const csr = join(work, "request.pem"),
        cert = join(work, "certificate.pem"),
        ext = join(work, "extensions.cnf");
      await writeFile(csr, csrPem, { mode: 0o600 });
      await exec("openssl", ["req", "-in", csr, "-verify", "-noout"]);
      const publicKey = (await exec("openssl", ["req", "-in", csr, "-pubkey", "-noout"])).stdout;
      await writeFile(
        ext,
        "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n",
        { mode: 0o600 },
      );
      await exec("openssl", [
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        join(this.directory, "ca.pem"),
        "-CAkey",
        join(this.directory, "ca-key.pem"),
        "-set_serial",
        `0x${randomBytes(16).toString("hex")}`,
        "-days",
        "30",
        "-subj",
        `/CN=${runnerId}/OU=${organizationId}`,
        "-extfile",
        ext,
        "-out",
        cert,
      ]);
      const certificatePem = await readFile(cert, "utf8"),
        certificate = new X509Certificate(certificatePem);
      const { createHash } = await import("node:crypto");
      return {
        certificatePem,
        fingerprint256: certificate.fingerprint256,
        expiresAt: new Date(certificate.validTo).toISOString(),
        publicKeyDigest: createHash("sha256").update(publicKey).digest("hex"),
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  async serverOptions() {
    return {
      key: await readFile(join(this.directory, "server-key.pem")),
      cert: await readFile(join(this.directory, "server.pem")),
      ca: await readFile(join(this.directory, "ca.pem")),
    };
  }
}
export async function createRunnerTlsServer(
  app: Pick<Hono, "fetch">,
  authority: RunnerCertificateAuthority,
): Promise<Server> {
  return createServer(
    {
      ...(await authority.serverOptions()),
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    },
    async (req, res) => {
      try {
        const path = req.url ?? "/";
        if (!path.startsWith("/api/v1/runner/") && path !== "/api/v1/fleet/enroll") {
          res.writeHead(404);
          res.end();
          return;
        }
        const socket = req.socket as TLSSocket;
        const certificate = socket.getPeerCertificate();
        const cn = certificate.subject?.CN,
          ou = certificate.subject?.OU;
        const runnerPeer: RunnerPeer | undefined =
          socket.authorized && typeof cn === "string" && typeof ou === "string"
            ? {
                authorized: true,
                fingerprint256: certificate.fingerprint256,
                organizationId: ou,
                runnerId: cn,
              }
            : undefined;
        const buffers: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) {
            res.writeHead(413);
            res.end();
            return;
          }
          buffers.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        const request = new Request(`https://localhost${path}`, {
          method: req.method,
          headers,
          ...(req.method !== "GET" && req.method !== "HEAD"
            ? { body: Buffer.concat(buffers) }
            : {}),
        });
        const response = await app.fetch(request, { runnerPeer });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "runner_transport_error" }));
      }
    },
  );
}
