# Windows PowerShell 5.1+; no Git, Node or administrator installation required.
[CmdletBinding()]
param(
  [string]$Ref = 'main',
  [string]$SourcePath = '',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AramMayhemWrapped'),
  [switch]$Demo,
  [switch]$NoBrowser,
  [switch]$InstallOnly,
  [ValidateRange(1024,65525)][int]$Port = 4173
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This launcher targets Windows x64. ARM64 is not verified.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$taskRoot = [IO.Path]::GetFullPath($InstallRoot)
$taskCache = Join-Path $taskRoot 'downloads'
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
function Download-File([string]$Url,[string]$Target) {
  $temporary = "$Target.partial"
  try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary; Move-Item -LiteralPath $temporary -Destination $Target -Force }
  finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}
function Check-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE). Keep this window open and report the message above." } }
$nodeVersion = '22.20.0'
$nodeName = "node-v$nodeVersion-win-x64"
$nodeHome = Join-Path (Join-Path $taskRoot 'runtime') $nodeName
$nodeExe = Join-Path $nodeHome 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Host 'Downloading portable Node.js from nodejs.org...'
  $nodeZip = Join-Path $taskCache "$nodeName.zip"
  $checksums = Join-Path $taskCache 'SHASUMS256.txt'
  Download-File "https://nodejs.org/dist/v$nodeVersion/$nodeName.zip" $nodeZip
  Download-File "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt" $checksums
  $checksumLines = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match ("\s+" + [regex]::Escape("$nodeName.zip") + '$') })
  if ($checksumLines.Count -ne 1) { throw 'Missing official Node.js checksum.' }
  $expectedHash = ($checksumLines[0] -split '\s+')[0]
  if ((Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Node.js checksum mismatch.' }
  $runtimeRoot = Join-Path $taskRoot 'runtime'
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $runtimeRoot)
}
if ((& $nodeExe --version) -ne "v$nodeVersion") { throw 'Unexpected portable Node version.' }
$env:PATH = "$nodeHome;$env:PATH"
$pnpmHome = Join-Path $taskRoot 'runtime/pnpm-10.18.2'
$pnpmCli = Join-Path $pnpmHome 'package/bin/pnpm.cjs'
if (-not (Test-Path -LiteralPath $pnpmCli)) {
  Write-Host 'Downloading pinned pnpm from npmjs.org...'
  $metadataFile = Join-Path $taskCache 'pnpm-metadata.json'
  Download-File 'https://registry.npmjs.org/pnpm/10.18.2' $metadataFile
  $metadata = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
  if ($metadata.dist.tarball -ne 'https://registry.npmjs.org/pnpm/-/pnpm-10.18.2.tgz') { throw 'Unexpected pnpm archive URL.' }
  $pnpmArchive = Join-Path $taskCache 'pnpm-10.18.2.tgz'
  Download-File $metadata.dist.tarball $pnpmArchive
  $sha = [Security.Cryptography.SHA512]::Create()
  try { $integrity = 'sha512-' + [Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($pnpmArchive))) } finally { $sha.Dispose() }
  if ($integrity -ne $metadata.dist.integrity) { throw 'pnpm integrity mismatch.' }
  New-Item -ItemType Directory -Force -Path $pnpmHome | Out-Null
  & tar.exe -xzf $pnpmArchive -C $pnpmHome
  Check-Exit 'pnpm extraction'
}
$tempDir = Join-Path $taskRoot 'runtime/temp'
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$env:TEMP = $tempDir
$env:TMP = $tempDir
if ($SourcePath) {
  $projectDir = (Resolve-Path -LiteralPath $SourcePath).Path
} else {
  if ($Ref -notmatch '^[A-Za-z0-9._/-]+$' -or $Ref.Contains('..')) { throw 'Invalid Git reference.' }
  $sourceZip = Join-Path $taskCache 'source.zip'
  Write-Host 'Downloading ARAM Mayhem Recap source from GitHub...'
  Download-File ("https://api.github.com/repos/Marc0Guo/aram-mayhem-recap-2026/zipball/" + [Uri]::EscapeDataString($Ref)) $sourceZip
  $sourceHash = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.Substring(0,16)
  $versionDir = Join-Path $taskRoot "app/$sourceHash"
  if (-not (Test-Path -LiteralPath $versionDir)) {
    New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $versionDir)
  }
  $roots = @(Get-ChildItem -LiteralPath $versionDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') })
  if ($roots.Count -ne 1) { throw 'Unexpected GitHub archive structure.' }
  $projectDir = $roots[0].FullName
}
Push-Location -LiteralPath $projectDir
try {
  $manifest = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'aram-mayhem-wrapped') { throw 'This is not an ARAM Mayhem Wrapped checkout.' }
  $lockHash = (Get-FileHash -LiteralPath 'pnpm-lock.yaml' -Algorithm SHA256).Hash
  $marker = Join-Path $projectDir 'node_modules/.aram-ready'
  if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $lockHash) {
    Write-Host 'Installing pinned dependencies (first launch may take several minutes)...'
    & $nodeExe $pnpmCli install --frozen-lockfile --ignore-scripts --store-dir (Join-Path $taskRoot 'runtime/pnpm-store')
    Check-Exit 'Dependency installation'
    Set-Content -LiteralPath $marker -Value $lockHash -Encoding ASCII
  }
  & $nodeExe 'scripts/native-smoke.cjs'
  Check-Exit 'SQLite compatibility check'
  if ($InstallOnly) { Write-Host 'Installation verified.'; return }
  $selectedPort = $Port
  while ($selectedPort -lt $Port + 10) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$selectedPort)
    try { $listener.Start(); $listener.Stop(); break } catch { $listener.Stop(); $selectedPort++ }
  }
  if ($selectedPort -ge $Port + 10) { throw 'No free localhost port found.' }
  $env:ARAM_WRAPPED_PORT = [string]$selectedPort
  $env:ARAM_WRAPPED_DATA_DIR = if ($Demo) { Join-Path $taskRoot 'demo' } else { $taskRoot }
  $env:ARAM_WRAPPED_MODE = if ($Demo) { 'demo' } else { 'real' }
  $env:ARAM_WRAPPED_OFFLINE = if ($Demo) { '1' } else { '0' }
  $env:ARAM_WRAPPED_OPEN_BROWSER = if ($NoBrowser) { '0' } else { '1' }
  Write-Host 'Keep this window open. Press Ctrl+C to stop the dashboard.'
  if ($Demo) { & $nodeExe 'scripts/web.mjs' demo } else { & $nodeExe 'scripts/web.mjs' }
  Check-Exit 'Dashboard'
} finally { Pop-Location }
