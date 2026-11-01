import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const HELP = `Rotate selected secrets in .env.local safely.

Usage:
  node scripts/rotate-env-secrets.mjs [options]

Options:
  --file <path>         Env file path (default: .env.local)
  --keys <k1,k2>        Keys to rotate (default: RESEND_INBOUND_TOKEN)
  --recommended         Rotate RESEND_INBOUND_TOKEN, CRON_SECRET
  --all                 Rotate RESEND_INBOUND_TOKEN, CRON_SECRET, PROVIDER_KEY_SECRET
  --help                Show this help

Notes:
  - This only updates local env file values.
  - If these keys are also in Vercel, copy the new values to Vercel too.
`;

const DEFAULT_KEYS = ["RESEND_INBOUND_TOKEN"];
const RECOMMENDED_KEYS = ["RESEND_INBOUND_TOKEN", "CRON_SECRET"];
const ALL_KEYS = ["RESEND_INBOUND_TOKEN", "CRON_SECRET", "PROVIDER_KEY_SECRET"];

function parseArgs(argv) {
  const args = { file: ".env.local", keys: [...DEFAULT_KEYS], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a === "--file") {
      args.file = argv[i + 1] || args.file;
      i++;
      continue;
    }
    if (a === "--keys") {
      const raw = argv[i + 1] || "";
      args.keys = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (a === "--recommended") {
      args.keys = [...RECOMMENDED_KEYS];
      continue;
    }
    if (a === "--all") {
      args.keys = [...ALL_KEYS];
      continue;
    }
  }
  return args;
}

function randomSecret(bytes = 48) {
  return crypto
    .randomBytes(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function maskSecret(value) {
  if (!value) return "(empty)";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function replaceOrAppend(lines, key, value) {
  const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
  const nextLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = nextLine;
    return;
  }
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(nextLine);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Env file not found: ${filePath}`);
    process.exit(1);
  }

  const file = fs.readFileSync(filePath, "utf8");
  const eol = file.includes("\r\n") ? "\r\n" : "\n";
  const lines = file.split(/\r?\n/);

  const rotated = [];
  for (const key of args.keys) {
    const value = randomSecret(48);
    replaceOrAppend(lines, key, value);
    rotated.push({ key, value });
  }

  fs.writeFileSync(filePath, lines.join(eol), "utf8");

  console.log(`Rotated ${rotated.length} key(s) in ${filePath}:`);
  for (const r of rotated) {
    console.log(`- ${r.key}: ${maskSecret(r.value)}`);
  }
  console.log("Sync the same values to Vercel for production keys.");
}

main();
