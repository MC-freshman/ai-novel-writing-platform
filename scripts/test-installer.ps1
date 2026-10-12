param([Parameter(Mandatory=$true)][string]$PreviousInstaller, [Parameter(Mandatory=$true)][string]$CurrentInstaller)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP) { throw '真实安装测试只允许在隔离的 GitHub Windows runner 执行。' }
$taskRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'novel-installer-verification'))
$runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $taskRoot.StartsWith($runnerRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '测试目录越出 runner 临时目录。' }
if (Test-Path -LiteralPath $taskRoot) { throw '测试目录已存在，拒绝复用未知安装。' }
$product = 'AI小说创作平台'
$registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Get-ProductRegistration {
  @(foreach ($root in $registryRoots) {
    if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -like "$product*" } }
  })
}
if ((Get-ProductRegistration).Count) { throw 'runner 已有同名应用，拒绝覆盖。' }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"
$startShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
foreach ($shortcut in @($desktopShortcut, $startShortcut)) { if (Test-Path -LiteralPath $shortcut) { throw "快捷方式已存在: $shortcut" } }
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$installPath = Join-Path $taskRoot 'installed'
$projectPath = Join-Path $taskRoot 'external-project'
$evidencePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.test-runs\installer'))
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $evidencePath.StartsWith($workspaceRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '验收报告目录越出项目工作区。' }
New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$report = [ordered]@{ status='running'; isolatedRunner=$env:RUNNER_NAME; oldVersion='0.3.8'; newVersion=$version; checks=@(); installPath=$installPath; externalProject=$projectPath }
function Run-Node([string[]]$Arguments) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Node 验收失败: $Arguments" }
}
function Install-Package([string]$Installer, [string]$ExpectedVersion) {
  $resolvedInstaller = (Resolve-Path -LiteralPath $Installer).Path
  $process = Start-Process -FilePath $resolvedInstaller -ArgumentList @('/S', '/currentuser', "/D=$installPath") -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) { throw '安装器运行超时。' }
  if ($process.ExitCode -ne 0) { throw "安装失败: $($process.ExitCode)" }
  $executablePath = Join-Path $installPath "$product.exe"
  if (-not (Test-Path -LiteralPath $executablePath)) { throw '安装完成但没有应用可执行文件。' }
  $registrations = Get-ProductRegistration
  if ($registrations.Count -ne 1 -or $registrations[0].DisplayVersion -ne $ExpectedVersion) { throw '卸载登记数量或版本不正确。' }
  foreach ($shortcut in @($desktopShortcut, $startShortcut)) { if (-not (Test-Path -LiteralPath $shortcut)) { throw "没有安装快捷方式: $shortcut" } }
  return $executablePath
}
try {
  Run-Node @((Join-Path $PSScriptRoot 'test-installed-app.cjs'), 'seed', $projectPath)
  $oldExecutable = Install-Package $PreviousInstaller '0.3.8'
  $report.checks += '真实0.3.8安装器静默安装、登记与快捷方式'
  Run-Node @((Join-Path $PSScriptRoot 'test-installed-app.cjs'), 'smoke', $projectPath, $oldExecutable, '0.3.8', (Join-Path $evidencePath 'old-installed-ui.json'))
  $beforeUpgrade = (Get-FileHash -LiteralPath (Join-Path $projectPath 'chapters\installer.md') -Algorithm SHA256).Hash
  $markerBefore = (Get-FileHash -LiteralPath (Join-Path $projectPath 'external-preserved.txt') -Algorithm SHA256).Hash
  $newExecutable = Install-Package $CurrentInstaller $version
  if ((Get-FileHash -LiteralPath (Join-Path $projectPath 'chapters\installer.md') -Algorithm SHA256).Hash -ne $beforeUpgrade) { throw '升级改动了外部项目正文。' }
  $report.checks += '原目录真实升级、外部项目正文哈希一致'
  Run-Node @((Join-Path $PSScriptRoot 'test-installed-app.cjs'), 'smoke', $projectPath, $newExecutable, $version, (Join-Path $evidencePath 'new-installed-ui.json'))
  $report.checks += '升级后真实窗口打开已有正文并通过保存按钮写入'
  $beforeUninstall = (Get-FileHash -LiteralPath (Join-Path $projectPath 'chapters\installer.md') -Algorithm SHA256).Hash
  $uninstaller = @(Get-ChildItem -LiteralPath $installPath -File | Where-Object Name -like 'Uninstall*.exe')
  if ($uninstaller.Count -ne 1) { throw '无法唯一确定本次安装的卸载器。' }
  $uninstall = Start-Process -FilePath $uninstaller[0].FullName -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -PassThru
  if (-not $uninstall.WaitForExit(120000) -or $uninstall.ExitCode -ne 0) { throw '卸载失败或超时。' }
  for ($attempt=0; $attempt -lt 60 -and (Test-Path -LiteralPath $newExecutable); $attempt++) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath $newExecutable) { throw '卸载后仍有应用可执行文件。' }
  if ((Get-ProductRegistration).Count) { throw '卸载登记未移除。' }
  foreach ($shortcut in @($desktopShortcut, $startShortcut)) { if (Test-Path -LiteralPath $shortcut) { throw '卸载后快捷方式仍在。' } }
  if ((Get-FileHash -LiteralPath (Join-Path $projectPath 'chapters\installer.md') -Algorithm SHA256).Hash -ne $beforeUninstall) { throw '卸载改动了项目正文。' }
  if ((Get-FileHash -LiteralPath (Join-Path $projectPath 'external-preserved.txt') -Algorithm SHA256).Hash -ne $markerBefore) { throw '卸载改动了外部项目数据。' }
  $report.checks += '真实卸载移除程序、登记和快捷方式，保留外部项目文件'
  $report.status = 'passed'
} catch {
  $report.status = 'failed'; $report.error = $_.Exception.Message; throw
} finally {
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidencePath 'installer.json') -Encoding utf8
}
