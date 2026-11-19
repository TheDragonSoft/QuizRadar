#!/usr/bin/env node
/** Install once, then take one process-cold Android staging startup sample. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.apk || !flags.revision || !flags.output) {
  console.error(
    "usage: node performance/android/sample.mjs --apk app-staging.apk --revision HEAD --output result.json [--serial emulator-5554]",
  );
  process.exit(2);
}
const adb = process.env.ADB ?? "adb";
const serial = flags.serial ? ["-s", String(flags.serial)] : [];
const apk = path.resolve(String(flags.apk));
const output = path.resolve(String(flags.output));
const logcatFile = `${output}.logcat.txt`;
const screenshotFile = `${output}.png`;
const run = (args, options = {}) =>
  execFileSync(adb, [...serial, ...args], { encoding: "utf8", ...options }).trim();

try {
  // Dedicated performance emulators must not inherit an app signed with a
  // different key; a stale install is not a QuizRadar performance regression.
  run(["uninstall", "com.quizradar.app"]);
  run(["install", "-r", apk], { maxBuffer: 16 * 1024 * 1024 });
  run(["shell", "am", "force-stop", "com.quizradar.app"]);
  run(["logcat", "-c"]);
  const started = run(["shell", "am", "start", "-W", "-n", "com.quizradar.app/.MainActivity"]);
  const totalTime = Number(/^TotalTime:\s*(\d+)$/m.exec(started)?.[1]);
  if (!Number.isFinite(totalTime) || totalTime < 0) {
    throw new Error(`am start did not report TotalTime:\n${started}`);
  }
  const processId = run(["shell", "pidof", "com.quizradar.app"]);
  if (!processId) throw new Error("QuizRadar process is not alive after launch");
  const logcat = run(["logcat", "-d", "-b", "all"], { maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(logcatFile, `${started}\n\n${logcat}`, "utf8");
  if (/FATAL EXCEPTION|ANR in com\.quizradar\.app|UnsatisfiedLinkError/.test(logcat)) {
    throw new Error(`crash, ANR, or native-link failure detected; see ${logcatFile}`);
  }
  const result = {
    schemaVersion: 1,
    surface: "android",
    revision: String(flags.revision),
    environment: {
      profile: "staging",
      measurement: "process-cold am start -W TotalTime; install excluded",
      serial: flags.serial ?? "default",
    },
    scenarios: [{ id: "startup.total_time", unit: "ms", samples: [totalTime] }],
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  mkdirSync(path.dirname(output), { recursive: true });
  try {
    writeFileSync(screenshotFile, run(["exec-out", "screencap", "-p"], { encoding: "buffer" }));
  } catch {
    // Preserve the original measurement failure if a screenshot is unavailable.
  }
  throw error;
}
