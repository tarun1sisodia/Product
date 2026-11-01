import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Readiness preflight, NOT an E2E result. Never invent projects or run against
// production. Live verification must use the TestSprite CLI and an approved
// staging/local target, as described in .agents/skills/testsprite-verify/.
const missing = [];
for (const path of [
  "react/CUSTOMER_REACT_PRD_TESTSPRITE.md",
  "react/TESTSPRITE_CUSTOMER_REACT_EXECUTION_PROMPT.md",
  "admin/ADMIN_PRD_TESTSPRITE.md",
  "admin/TESTSPRITE_ADMIN_EXECUTION_PROMPT.md",
]) {
  if (!existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url)))) missing.push(`Missing test specification: ${path}`);
}
const version = spawnSync("testsprite", ["--version"], { encoding: "utf8", timeout: 15000 });
if (version.error || version.status !== 0) {
  missing.push("TestSprite CLI is not installed/working. Install the CLI and run testsprite setup outside this check.");
} else {
  const auth = spawnSync("testsprite", ["auth", "status"], { encoding: "utf8", timeout: 15000 });
  if (auth.error || auth.status !== 0) missing.push("TestSprite authentication is not ready. Run testsprite setup; never paste credentials into chat.");
}
if (missing.length) {
  console.error(`TestSprite preflight BLOCKED:\n- ${missing.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Local TestSprite specifications and CLI authentication are ready. No browser tests ran; a linked project, approved target, and actual terminal test verdict are still required.");
}
