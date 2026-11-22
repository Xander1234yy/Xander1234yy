#!/usr/bin/env node
// Start de HomeOS Device Connector en de webapp tegelijk, zonder extra afhankelijkheden.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const colors = { connector: "\x1b[35m", web: "\x1b[36m" };
const reset = "\x1b[0m";
const children = [];

function run(name, args, extraEnv = {}) {
  const child = spawn(npm, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "1", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${colors[name]}[${name}]${reset} `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}gestopt (code ${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!existsSync(path.join(root, "node_modules"))) {
  console.error("Voer eerst 'npm install' uit.");
  process.exit(1);
}

console.log("\n  HomeOS — Your home. One intelligent system.\n  Webapp:    http://127.0.0.1:3000\n  Connector: http://127.0.0.1:8787 (alleen lokaal)\n");
// Draait de connector al (bijv. via de macOS-LaunchAgent)? Dan alleen de webapp starten.
const port = process.env.HOMEOS_CONNECTOR_PORT ?? "8787";
const running = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
  .then((r) => r.ok)
  .catch(() => false);
if (running) {
  console.log(`  Connector draait al op poort ${port} (bijv. als achtergronddienst); alleen de webapp wordt gestart.\n`);
  run("web", ["run", "dev", "-w", "@homeos/web"]);
} else {
  run("connector", ["run", "dev", "-w", "@homeos/connector"]);
  // Geef de connector even de tijd om zijn identiteit en token aan te maken.
  setTimeout(() => run("web", ["run", "dev", "-w", "@homeos/web"]), 1500);
}
