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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = async (args, options = {}) =>
  execFileSync(adb, [...serial, ...args], { encoding: "utf8", ...options }).trim();
// CI emulators can briefly report `device offline` after snapshot boot; retry
// only that class of transient transport error so evidence is not lost.
async function runWithDeviceRetry(args, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run(args, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      if (
        !/device offline|device ('|")?emulator-\d+('|")? not found|device unauthorized|closed/i.test(
          message,
        )
      ) {
        throw error;
      }
      if (attempt === 2) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

try {
  // Dedicated performance emulators must not inherit an app signed with a
  // different key; a fresh emulator may simply have nothing to uninstall.
  try {
    await runWithDeviceRetry(["uninstall", "com.quizradar.app"]);
  } catch {
    // Fresh device: proceed to install; signature mismatch is handled by a
    // successful uninstall when a previous package actually exists.
  }
  await runWithDeviceRetry(["install", "-r", apk], { maxBuffer: 16 * 1024 * 1024 });
  await runWithDeviceRetry(["shell", "am", "force-stop", "com.quizradar.app"]);
  await runWithDeviceRetry(["logcat", "-c"]);
  const started = await runWithDeviceRetry([
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    "com.quizradar.app/.MainActivity",
  ]);
  const totalTime = Number(/^TotalTime:\s*(\d+)$/m.exec(started)?.[1]);
  if (!Number.isFinite(totalTime) || totalTime < 0) {
    throw new Error(`am start did not report TotalTime:\n${started}`);
  }
  const processId = await runWithDeviceRetry(["shell", "pidof", "com.quizradar.app"]);
  if (!processId) throw new Error("QuizRadar process is not alive after launch");
  const logcat = await runWithDeviceRetry(["logcat", "-d", "-b", "all"], {
    maxBuffer: 32 * 1024 * 1024,
  });
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
    writeFileSync(
      screenshotFile,
      await run(["exec-out", "screencap", "-p"], { encoding: "buffer" }),
    );
  } catch {
    // Preserve the original measurement failure if a screenshot is unavailable.
  }
  throw error;
}
