import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = parseInt(
  process.env.BROWSE_SKILL_TIMEOUT_MS ?? "60000",
  10,
);

/** True when BROWSERBASE_API_KEY is configured. */
export function isBrowseAvailable(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY);
}

function getBrowseBin(): string {
  return process.env.BROWSE_BIN ?? "browse";
}

async function execBrowse(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(getBrowseBin(), args, {
    timeout: CLI_TIMEOUT_MS,
    env: {
      ...process.env,
      BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY ?? "",
      BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID ?? "",
    } as Record<string, string>,
    maxBuffer: 4 * 1024 * 1024,
  });
  return `${stdout}\n${stderr}`;
}

/**
 * Extract the first JSON object or array from CLI output.
 * browse may emit log lines or ANSI codes before the JSON payload.
 */
export function extractJson<T>(output: string): T {
  const match = output.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) {
    throw new Error(
      `browse CLI returned no JSON. Output: ${output.slice(0, 300)}`,
    );
  }
  return JSON.parse(match[1]) as T;
}

/**
 * Invoke a browse.sh skill. Tries `browse run <id> --params ... --json` first
 * (the documented form), then falls back to `browse functions invoke <id> --params ...`
 * (alternate form for published skills). Throws only if both forms fail.
 */
export async function runSkill<T>(
  skillId: string,
  params: Record<string, unknown>,
): Promise<T> {
  const paramsJson = JSON.stringify(params);
  try {
    const out = await execBrowse(["run", skillId, "--params", paramsJson, "--json"]);
    return extractJson<T>(out);
  } catch (primaryErr) {
    try {
      const out = await execBrowse([
        "functions",
        "invoke",
        skillId,
        "--params",
        paramsJson,
      ]);
      return extractJson<T>(out);
    } catch {
      throw primaryErr;
    }
  }
}
