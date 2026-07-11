/**
 * Detector CLI — the bridge the Python `ml/` replay harness drives so model
 * evaluation runs the REAL on-device detector (no Python port to drift).
 *
 *   node dist/cli.js synth [--preset demo|clean] [--seed N]
 *     Write a golden RecordedDrive JSON (with embedded `truth`) to stdout.
 *
 *   node dist/cli.js replay [--model-version V]
 *     Read a RecordedDrive JSON on stdin, run the batch detector, write
 *     {"events": JoltEvent[]} to stdout. Deterministic: sequential event ids.
 */
import process from "node:process";
import { makeGoldenDrive, type GoldenPreset } from "./golden.js";
import { replayDrive, type RecordedDrive } from "./replay.js";
import type { PipelineDeps } from "./detect.js";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    );
    process.stdin.on("error", reject);
  });
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "synth") {
    const preset = (argValue(args, "--preset") ?? "demo") as GoldenPreset;
    if (preset !== "demo" && preset !== "clean") {
      fail(`unknown preset "${preset}" (expected demo|clean)`);
    }
    const seedRaw = argValue(args, "--seed");
    const seed = seedRaw === undefined ? undefined : Number(seedRaw);
    if (seed !== undefined && !Number.isFinite(seed)) {
      fail(`invalid --seed "${seedRaw}"`);
    }
    process.stdout.write(JSON.stringify(makeGoldenDrive(preset, seed)));
    return;
  }

  if (command === "replay") {
    let drive: RecordedDrive;
    try {
      drive = JSON.parse(await readStdin()) as RecordedDrive;
    } catch {
      fail("stdin is not valid JSON (expected a RecordedDrive)");
    }
    if (!Array.isArray(drive.samples) || !Array.isArray(drive.gps)) {
      fail("RecordedDrive must have `samples` and `gps` arrays");
    }
    let i = 0;
    const deps: PipelineDeps = {
      nextId: () => `replay-${++i}`,
      modelVersion: argValue(args, "--model-version") ?? "heuristic-v0",
    };
    process.stdout.write(JSON.stringify({ events: replayDrive(drive, deps) }));
    return;
  }

  fail(`usage: cli.js <synth|replay> [options] (got "${command ?? ""}")`);
}

main().catch((err) => fail(String(err)));
