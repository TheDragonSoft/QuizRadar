/**
 * Shared statistics and regression-gate logic for QuizRadar performance runs.
 * Timings are milliseconds. The comparator never updates thresholds or hides
 * missing/incompatible measurements behind a passing result.
 */

export const PERFORMANCE_SCHEMA_VERSION = 1;
export const PERFORMANCE_SURFACES = ["core", "web", "android", "desktop"];

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("samples must be a non-empty array");
  }
  if (samples.some((value) => !finiteNumber(value) || value < 0)) {
    throw new Error("samples must contain only finite, non-negative millisecond values");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction) => {
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export function resolveThreshold(thresholds, surface, scenarioId) {
  const surfaceDefault = thresholds?.defaults?.[surface];
  if (!surfaceDefault) throw new Error(`no default threshold for surface ${surface}`);
  const override = thresholds?.scenarios?.[`${surface}.${scenarioId}`] ?? {};
  const resolved = { ...surfaceDefault, ...override };
  for (const field of ["maxRegressionPercent", "minAbsoluteDeltaMs", "samples"]) {
    if (!finiteNumber(resolved[field]) || resolved[field] < 0) {
      throw new Error(`invalid ${field} for ${surface}.${scenarioId}`);
    }
  }
  if (!Number.isInteger(resolved.samples) || resolved.samples < 1) {
    throw new Error(`samples must be a positive integer for ${surface}.${scenarioId}`);
  }
  return resolved;
}

function validateResult(result, expectedSurface, revision) {
  if (!result || result.schemaVersion !== PERFORMANCE_SCHEMA_VERSION) {
    throw new Error(`${revision}: unsupported or missing performance schemaVersion`);
  }
  if (result.surface !== expectedSurface) {
    throw new Error(`${revision}: expected surface ${expectedSurface}, received ${result.surface}`);
  }
  if (!Array.isArray(result.scenarios)) {
    throw new Error(`${revision}: scenarios must be an array`);
  }
  const byId = new Map();
  for (const scenario of result.scenarios) {
    if (!scenario || typeof scenario.id !== "string" || scenario.id.trim() === "") {
      throw new Error(`${revision}: every scenario needs a non-empty id`);
    }
    if (byId.has(scenario.id)) throw new Error(`${revision}: duplicate scenario ${scenario.id}`);
    byId.set(scenario.id, scenario);
  }
  return byId;
}

function errorScenario(id, reason) {
  return { id, status: "error", reason };
}

export function comparePerformanceResults({ base, head, thresholds, surface }) {
  const baseScenarios = validateResult(base, surface, "base");
  const headScenarios = validateResult(head, surface, "head");
  const ids = [...new Set([...baseScenarios.keys(), ...headScenarios.keys()])].sort();
  if (ids.length === 0) throw new Error("no performance scenarios were reported");

  const scenarios = ids.map((id) => {
    const baseScenario = baseScenarios.get(id);
    const headScenario = headScenarios.get(id);
    if (!baseScenario) return errorScenario(id, "scenario is absent from the base result");
    if (!headScenario) return errorScenario(id, "scenario is absent from the head result");
    let threshold;
    let baseStats;
    let headStats;
    try {
      threshold = resolveThreshold(thresholds, surface, id);
      baseStats = summarizeSamples(baseScenario.samples);
      headStats = summarizeSamples(headScenario.samples);
    } catch (error) {
      return errorScenario(id, error instanceof Error ? error.message : String(error));
    }
    if (baseStats.count < threshold.samples || headStats.count < threshold.samples) {
      return errorScenario(
        id,
        `requires ${threshold.samples} samples per revision (base=${baseStats.count}, head=${headStats.count})`,
      );
    }

    const deltaMs = headStats.p50 - baseStats.p50;
    const regressionPercent =
      baseStats.p50 === 0
        ? deltaMs > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : (deltaMs / baseStats.p50) * 100;
    const regression =
      deltaMs > threshold.minAbsoluteDeltaMs && regressionPercent > threshold.maxRegressionPercent;
    const improvement =
      deltaMs < -threshold.minAbsoluteDeltaMs &&
      regressionPercent < -threshold.maxRegressionPercent;
    return {
      id,
      status: regression ? "regression" : improvement ? "improvement" : "pass",
      unit: "ms",
      threshold,
      base: { ...baseStats, samples: baseScenario.samples },
      head: { ...headStats, samples: headScenario.samples },
      deltaMs,
      regressionPercent,
    };
  });

  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    surface,
    baseRevision: base.revision ?? null,
    headRevision: head.revision ?? null,
    passed: scenarios.every(
      (scenario) => scenario.status !== "regression" && scenario.status !== "error",
    ),
    scenarios,
  };
}

function formatMs(value) {
  return finiteNumber(value) ? `${value.toFixed(3)} ms` : "—";
}

function formatPercent(value) {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  return finiteNumber(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

export function renderPerformanceMarkdown(comparison, { title } = {}) {
  const lines = [
    `## ${title ?? `Performance comparison — ${comparison.surface}`}`,
    "",
    `- Base: \`${comparison.baseRevision ?? "unknown"}\``,
    `- Head: \`${comparison.headRevision ?? "unknown"}\``,
    `- Verdict: **${comparison.passed ? "PASS" : "REVIEW REQUIRED"}**`,
    "",
    "| Scenario | Base p50 | Head p50 | Δ | Δ% | Gate | Result |",
    "|---|---:|---:|---:|---:|---|---|",
  ];
  for (const scenario of comparison.scenarios) {
    if (scenario.status === "error") {
      lines.push(`| \`${scenario.id}\` | — | — | — | — | — | ERROR: ${scenario.reason} |`);
      continue;
    }
    lines.push(
      `| \`${scenario.id}\` | ${formatMs(scenario.base.p50)} | ${formatMs(scenario.head.p50)} | ${formatMs(scenario.deltaMs)} | ${formatPercent(scenario.regressionPercent)} | >${scenario.threshold.maxRegressionPercent}% and >${scenario.threshold.minAbsoluteDeltaMs} ms | ${scenario.status.toUpperCase()} |`,
    );
  }
  lines.push(
    "",
    "Gate uses median samples; raw samples and p95 values are in the JSON report.",
    "",
  );
  return lines.join("\n");
}
