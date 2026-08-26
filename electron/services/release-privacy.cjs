const fs = require("node:fs/promises");
const path = require("node:path");

const TEXT_EXTENSIONS = new Set([".cjs", ".js", ".json", ".html", ".css", ".md", ".txt"]);
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "release", ".test-runs", "backups", "projects"]);
const RULES = [
  { id: "api-key", label: "疑似 API 密钥", pattern: /\bsk-(?:ws-)?[A-Za-z0-9._-]{20,}\b/g },
  { id: "private-key", label: "私钥内容", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "personal-path", label: "本机用户目录", pattern: /[A-Za-z]:\\Users\\[^\\\r\n"']+/g },
  { id: "credential-blob", label: "疑似明文凭据字段", pattern: /"(?:apiKey|embeddingApiKey)"\s*:\s*"(?!credential:\/\/|\s*")[^"]{12,}"/g },
];

async function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return [relative || path.basename(root)];
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_SEGMENTS.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function scanReleaseInputs(workspaceRoot, roots = ["dist", "electron", "package.json"]) {
  const findings = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  for (const entry of roots) {
    const absoluteRoot = path.join(workspaceRoot, entry);
    const stat = await fs.stat(absoluteRoot).catch(() => null);
    if (!stat) continue;
    const files = stat.isFile() ? [entry] : (await walk(absoluteRoot)).map((file) => path.join(entry, file));
    for (const relativePath of files) {
      if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
      const absolutePath = path.join(workspaceRoot, relativePath);
      const body = await fs.readFile(absolutePath);
      scannedFiles += 1;
      scannedBytes += body.length;
      if (body.length > 12 * 1024 * 1024) continue;
      const text = body.toString("utf8");
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        for (const match of text.matchAll(rule.pattern)) {
          const line = text.slice(0, match.index).split(/\r?\n/).length;
          findings.push({ rule: rule.id, label: rule.label, file: relativePath.replace(/\\/g, "/"), line, preview: String(match[0]).slice(0, 8) + "..." });
          if (findings.length >= 200) break;
        }
        if (findings.length >= 200) break;
      }
    }
  }
  return { ok: findings.length === 0, scannedFiles, scannedBytes, findings, checkedAt: new Date().toISOString() };
}

module.exports = { scanReleaseInputs };
