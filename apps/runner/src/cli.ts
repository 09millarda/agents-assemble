#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { RunnerDaemon } from "../../../packages/runner/src/daemon.ts";
import { RunnerJournal } from "../../../packages/runner/src/journal.ts";
import { doctor } from "../../../packages/runner/src/native.ts";
import {
  enrollmentResponseSchema,
  PROTOCOL_VERSION,
} from "../../../packages/runner/src/protocol.ts";
import {
  lowPrivilegeCommand,
  nativeSource,
  ProtectedSupervisor,
  readSupervisorConfig,
} from "../../../packages/runner/src/supervisor.ts";
import {
  type RunnerConfig,
  RunnerTransport,
  runnerConfigSchema,
} from "../../../packages/runner/src/transport.ts";

const exec = promisify(execFile);
async function durableWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  await handle.writeFile(value);
  await handle.sync();
  await handle.close();
  await rename(temp, path);
  const directory = await open(dirname(path), "r");
  await directory.sync();
  await directory.close();
}
async function configAt(directory: string): Promise<RunnerConfig> {
  return runnerConfigSchema.parse(
    JSON.parse(await readFile(join(directory, "config.json"), "utf8")),
  );
}
async function stdinToken(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (text.length > 4096) throw new Error("enrollment_token_too_large");
  }
  return z.string().min(20).max(1024).parse(text.trim());
}
function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      directory: { type: "string" },
      service: { type: "string" },
      ca: { type: "string" },
      "token-file": { type: "string" },
      "token-stdin": { type: "boolean" },
      codex: { type: "string" },
      protected: { type: "boolean" },
      "secret-file": { type: "string" },
      once: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [command, action] = parsed.positionals;
  const options = parsed.values;
  const directory = resolve(
    options.directory ?? join(homedir(), ".local", "share", "agents-assemble"),
  );
  const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (options.help || !command) {
    process.stdout.write(
      "Agents Assemble runner\n\naa doctor [--codex /path/to/codex] [--protected]\naa service --service https://host:3443 --ca /path/to/ca.pem\naa enroll [--service URL --ca FILE] --token-stdin [--protected]\naa rotate --token-stdin\naa daemon install|start|stop|restart|status|run [--once]\naa status\naa de-enroll\n\nUse --directory PATH to select local runner state. Model login remains with Codex.\n",
    );
    return;
  }
  if (command === "doctor") {
    const settings = options.protected ? await readSupervisorConfig() : undefined;
    output(
      await doctor(
        settings?.codexBinary ?? options.codex,
        settings
          ? {
              sourceEnvironment: nativeSource(settings),
              launcher: lowPrivilegeCommand(
                settings.codexBinary,
                ["app-server", "--stdio"],
                settings,
              ),
              versionLauncher: lowPrivilegeCommand(settings.codexBinary, ["--version"], settings),
            }
          : {},
      ),
    );
    return;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (command === "service") {
    if (!options.service || !options.ca) throw new Error("service_and_ca_required");
    new RunnerTransport(options.service, { caFile: resolve(options.ca) });
    await durableWrite(
      join(directory, "service.json"),
      JSON.stringify({ serviceUrl: options.service, caFile: resolve(options.ca) }),
    );
    output({ status: "service_selected", serviceUrl: options.service });
    return;
  }
  if (command === "enroll" || command === "rotate") {
    if (command === "enroll" && existsSync(join(directory, "config.json")))
      throw new Error("runner_already_enrolled");
    const current = command === "rotate" ? await configAt(directory) : undefined;
    const supervisor =
      options.protected || current?.supervisor ? await readSupervisorConfig() : undefined;
    if (
      supervisor &&
      (directory !== supervisor.runnerDirectory ||
        (options.codex && options.codex !== supervisor.codexBinary))
    )
      throw new Error("supervisor_configuration_mismatch");
    const selected = existsSync(join(directory, "service.json"))
      ? z
          .object({ serviceUrl: z.string(), caFile: z.string() })
          .parse(JSON.parse(await readFile(join(directory, "service.json"), "utf8")))
      : undefined;
    const serviceUrl = options.service ?? current?.serviceUrl ?? selected?.serviceUrl;
    const caFile = options.ca ? resolve(options.ca) : (current?.caFile ?? selected?.caFile);
    if (!serviceUrl || !caFile) throw new Error("service_and_ca_required");
    const token = options["token-file"]
      ? (await readFile(resolve(options["token-file"]), "utf8")).trim()
      : options["token-stdin"]
        ? await stdinToken()
        : undefined;
    if (!token) throw new Error("provide_enrollment_token_via_stdin_or_file");
    const journal = new RunnerJournal(join(directory, "journal"));
    const journalId = journal.journalId;
    journal.close();
    const pendingPath = join(
      directory,
      command === "rotate" ? "rotation-pending.json" : "enrollment-pending.json",
    );
    const pending = existsSync(pendingPath)
      ? z
          .object({
            operationId: z.string(),
            journalId: z.string(),
            serviceUrl: z.string(),
            caFile: z.string(),
          })
          .parse(JSON.parse(await readFile(pendingPath, "utf8")))
      : { operationId: randomUUID(), journalId, serviceUrl, caFile };
    if (
      pending.journalId !== journalId ||
      pending.serviceUrl !== serviceUrl ||
      pending.caFile !== caFile
    )
      throw new Error("enrollment_retry_scope_conflict");
    await durableWrite(pendingPath, JSON.stringify(pending));
    const keyFile = join(directory, `runner-key-${pending.operationId}.pem`),
      csrFile = join(directory, `runner-${pending.operationId}.csr.pem`);
    if (!existsSync(keyFile)) {
      await exec("openssl", [
        "genpkey",
        "-algorithm",
        "EC",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-out",
        keyFile,
      ]);
      await chmod(keyFile, 0o600);
    }
    if (!existsSync(csrFile))
      await exec("openssl", [
        "req",
        "-new",
        "-key",
        keyFile,
        "-subj",
        `/CN=aa-runner-${pending.operationId}`,
        "-out",
        csrFile,
      ]);
    const transport = new RunnerTransport(serviceUrl, { caFile });
    const result = enrollmentResponseSchema.parse(
      await transport.post("/api/v1/fleet/enroll", {
        version: PROTOCOL_VERSION,
        operationId: pending.operationId,
        enrollmentToken: token,
        csrPem: await readFile(csrFile, "utf8"),
        journalId,
      }),
    );
    const certificateFile = join(directory, "runner-certificate.pem"),
      storedCaFile = join(directory, "service-ca.pem");
    const certificate = new X509Certificate(result.certificatePem),
      authority = new X509Certificate(await readFile(caFile));
    if (!certificate.verify(authority.publicKey))
      throw new Error("enrollment_certificate_untrusted");
    if (new X509Certificate(result.caPem).fingerprint256 !== authority.fingerprint256)
      throw new Error("enrollment_ca_substitution");
    await durableWrite(certificateFile, result.certificatePem);
    await durableWrite(storedCaFile, result.caPem);
    const config = runnerConfigSchema.parse({
      version: PROTOCOL_VERSION,
      serviceUrl,
      runnerId: result.runnerId,
      organizationId: result.organizationId,
      deploymentId: result.deploymentId,
      journalId,
      credentialGeneration: result.credentialGeneration,
      expiresAt: result.expiresAt,
      certificateFile,
      privateKeyFile: keyFile,
      caFile: storedCaFile,
      codexBinary: supervisor?.codexBinary ?? options.codex ?? current?.codexBinary ?? "codex",
      ...(supervisor ? { supervisor } : {}),
      ...(options["secret-file"]
        ? { secretFile: resolve(options["secret-file"]) }
        : current?.secretFile
          ? { secretFile: current.secretFile }
          : {}),
    });
    await durableWrite(join(directory, "config.json"), JSON.stringify(config));
    output({
      status: "enrolled",
      runnerId: result.runnerId,
      journalId,
      credentialGeneration: result.credentialGeneration,
    });
    return;
  }
  if (command === "status") {
    const config = await configAt(directory);
    if (existsSync(join(directory, "journal", "journal.lock"))) {
      output({
        status: "daemon_owns_journal",
        runnerId: config.runnerId,
        serviceUrl: config.serviceUrl,
        credentialExpiresAt: config.expiresAt,
        journalId: config.journalId,
        details:
          "Use daemon status for the service process and the control plane for accepted receipts.",
      });
      return;
    }
    const journal = new RunnerJournal(join(directory, "journal"), config.journalId);
    output({
      status: "enrolled",
      runnerId: config.runnerId,
      serviceUrl: config.serviceUrl,
      credentialExpiresAt: config.expiresAt,
      journalId: journal.journalId,
      sequence: journal.sequence,
      attempts: journal.states().map((state) => ({
        commandId: state.command.commandId,
        attemptId: state.command.scope.attemptId,
        stage: state.stage,
      })),
      pendingReceipts: journal.pendingReceipts().length,
    });
    journal.close();
    return;
  }
  if (command === "daemon") {
    if (action === "run") {
      const daemon = new RunnerDaemon(directory, await configAt(directory));
      const stop = () => daemon.stop();
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      try {
        if (options.once) {
          await daemon.tick();
          await daemon.drain();
          await daemon.tick();
        } else await daemon.run();
        await daemon.drain();
      } finally {
        process.off("SIGTERM", stop);
        process.off("SIGINT", stop);
        daemon.close();
      }
      return;
    }
    if (action === "install") {
      const config = await configAt(directory);
      if (config.supervisor) {
        await new ProtectedSupervisor(config.supervisor).verify(directory);
        await exec("/usr/bin/systemctl", ["enable", "agents-assemble-protected.service"]);
        output({
          status: "installed",
          unit: "/etc/systemd/system/agents-assemble-protected.service",
          runnerId: config.runnerId,
        });
        return;
      }
      const unit = join(homedir(), ".config", "systemd", "user", "agents-assemble.service");
      const binary = fileURLToPath(import.meta.url);
      if (binary.endsWith(".ts")) throw new Error("build_and_install_cli_before_service_install");
      const body = `[Unit]\nDescription=Agents Assemble customer runner\nAfter=network-online.target\n\n[Service]\nType=exec\nExecStart=${systemdQuote(process.execPath)} ${systemdQuote(binary)} daemon run --directory ${systemdQuote(directory)}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nEnvironment=PATH=${systemdQuote(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")}\n\n[Install]\nWantedBy=default.target\n`;
      await durableWrite(unit, body);
      await exec("systemctl", ["--user", "daemon-reload"]);
      await exec("systemctl", ["--user", "enable", "agents-assemble.service"]);
      output({ status: "installed", unit, runnerId: config.runnerId });
      return;
    }
    if (["start", "stop", "restart", "status"].includes(action ?? "")) {
      const config = await configAt(directory);
      if (config.supervisor) await new ProtectedSupervisor(config.supervisor).verify(directory);
      const result = await exec("/usr/bin/systemctl", [
        ...(config.supervisor ? [] : ["--user"]),
        action ?? "status",
        config.supervisor ? "agents-assemble-protected.service" : "agents-assemble.service",
        ...(action === "status" ? ["--no-pager"] : []),
      ]);
      process.stdout.write(result.stdout);
      return;
    }
    throw new Error("unknown_daemon_action");
  }
  if (command === "de-enroll") {
    const config = await configAt(directory);
    const transport = new RunnerTransport(config.serviceUrl, config);
    await transport.post("/api/v1/runner/de-enroll", {
      version: PROTOCOL_VERSION,
      runnerId: config.runnerId,
      journalId: config.journalId,
      operationId: randomUUID(),
    });
    // Keep journal and credentials for historical recovery. Removal does not assert stopped writers.
    await durableWrite(
      join(directory, "de-enrolled.json"),
      JSON.stringify({ runnerId: config.runnerId, at: new Date().toISOString() }),
    );
    output({ status: "de_enrolled", historyRetained: true, writerCoverage: "incomplete" });
    return;
  }
  throw new Error("unknown_command");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error && /^[a-z_]+(?::[A-Z_]+)?$/.test(error.message) ? error.message : "runner_operation_failed"}\n`,
    );
    process.exitCode = 1;
  });
}
