import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { JoltEvent } from "@potholeproof/shared-types";
import { makeGoldenDrive } from "./golden.js";
import { replayDrive } from "./replay.js";
import type { PipelineDeps } from "./detect.js";

const execFileAsync = promisify(execFile);

function makeDeps(): PipelineDeps {
  let i = 0;
  return { nextId: () => `evt-${++i}`, modelVersion: "heuristic-v0" };
}

test("demo golden drive detects exactly its ground truth", () => {
  const drive = makeGoldenDrive("demo");
  const events = replayDrive(drive, makeDeps());
  assert.equal(events.length, drive.truth.length);
  const kinds = events.map((e) => e.classification).sort();
  assert.deepEqual(kinds, ["pothole", "pothole", "pothole", "speed_bump"]);
});

test("clean golden drive yields no events (false-positive floor)", () => {
  const drive = makeGoldenDrive("clean");
  assert.equal(drive.truth.length, 0);
  assert.deepEqual(replayDrive(drive, makeDeps()), []);
});

test("golden drives are deterministic for a given seed", () => {
  const a = makeGoldenDrive("demo", 7);
  const b = makeGoldenDrive("demo", 7);
  assert.deepEqual(a, b);
  const c = makeGoldenDrive("demo", 8);
  assert.notDeepEqual(a.samples, c.samples);
});

test("cli synth | replay round-trips through the compiled bridge", async () => {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const synth = await execFileAsync(process.execPath, [
    cliPath,
    "synth",
    "--preset",
    "demo",
  ]);
  const drive = JSON.parse(synth.stdout);
  assert.equal(drive.truth.length, 4);

  const replay = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [cliPath, "replay", "--model-version", "cli-test"],
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
    child.stdin!.end(synth.stdout);
  });
  const { events } = JSON.parse(replay) as { events: JoltEvent[] };
  assert.equal(events.length, 4);
  assert.equal(events[0]!.modelVersion, "cli-test");
  assert.equal(events[0]!.id, "replay-1");
});
