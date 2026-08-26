const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NovelCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);
  [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("Advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr buffer);
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$request.target
if ($request.action -eq 'set') {
  $bytes = [Text.Encoding]::Unicode.GetBytes([string]$request.secret)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $credential = New-Object NovelCredentialManager+CREDENTIAL
    $credential.Type = 1
    $credential.TargetName = $target
    $credential.CredentialBlobSize = $bytes.Length
    $credential.CredentialBlob = $blob
    $credential.Persist = 2
    $credential.UserName = 'AI小说创作平台'
    if (-not [NovelCredentialManager]::CredWrite([ref]$credential, 0)) { throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($blob) }
  @{ ok = $true } | ConvertTo-Json -Compress
} elseif ($request.action -eq 'get') {
  $ptr = [IntPtr]::Zero
  if (-not [NovelCredentialManager]::CredRead($target, 1, 0, [ref]$ptr)) {
    @{ ok = $true; secret = '' } | ConvertTo-Json -Compress
  } else {
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][NovelCredentialManager+CREDENTIAL])
      $bytes = New-Object byte[] $credential.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
      @{ ok = $true; secret = [Text.Encoding]::Unicode.GetString($bytes) } | ConvertTo-Json -Compress
    } finally { [NovelCredentialManager]::CredFree($ptr) }
  }
} elseif ($request.action -eq 'delete') {
  [void][NovelCredentialManager]::CredDelete($target, 1, 0)
  @{ ok = $true } | ConvertTo-Json -Compress
} else { throw 'Unknown credential action' }
`;

const encodedScript = Buffer.from(SCRIPT, "utf16le").toString("base64");

function credentialTarget(projectPath, kind) {
  const projectId = crypto.createHash("sha256").update(String(projectPath || ""), "utf8").digest("hex").slice(0, 24);
  return `AI小说创作平台/${projectId}/${kind === "embedding" ? "embedding" : "chat"}`;
}

function invoke(payload) {
  if (process.platform !== "win32") return Promise.reject(new Error("Windows 凭据管理器仅在 Windows 上可用。"));
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedScript], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Windows 凭据管理器返回 ${code}`));
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`无法读取 Windows 凭据管理器结果：${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function setSecret(projectPath, kind, secret) {
  const target = credentialTarget(projectPath, kind);
  if (!secret) return deleteSecret(projectPath, kind);
  await invoke({ action: "set", target, secret: String(secret) });
  return { target };
}

async function getSecret(projectPath, kind) {
  const result = await invoke({ action: "get", target: credentialTarget(projectPath, kind) });
  return String(result?.secret || "");
}

async function deleteSecret(projectPath, kind) {
  await invoke({ action: "delete", target: credentialTarget(projectPath, kind) });
  return { deleted: true };
}

module.exports = { credentialTarget, deleteSecret, getSecret, setSecret };
