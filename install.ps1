[CmdletBinding()]
param(
  [string]$InstallDir,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-JsonPackageName([string]$Path) {
  $packagePath = Join-Path -Path $Path -ChildPath 'package.json'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { return $null }
  try {
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    return [string]$package.name
  } catch {
    return $null
  }
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $currentPath = $env:Path
  $parts = @($machinePath, $userPath, $currentPath) | Where-Object { $_ }
  $env:Path = (($parts -join ';').Split(';') | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $null }
  try {
    $version = (& node --version 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v?(\d+)') { return $null }
    return [int]$Matches[1]
  } catch {
    return $null
  }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$FailureMessage) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

$scriptDir = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$scriptIsRepo = (Get-JsonPackageName $scriptDir) -eq 'dividend-tracker'
$installDirProvided = -not [string]::IsNullOrWhiteSpace($InstallDir)
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  if ($scriptIsRepo) {
    $InstallDir = $scriptDir
  } else {
    $InstallDir = Join-Path -Path $HOME -ChildPath 'DividendTracker'
  }
}
$target = [System.IO.Path]::GetFullPath($InstallDir)

if ($DryRun) {
  Write-Host 'DryRun：只顯示安裝計畫，不會安裝軟體、連網、clone、建立目錄或修改檔案。'
  Write-Host "目標目錄：$target"
  Write-Host '將檢查 Git、Node.js 22+ 與 npm，必要時使用 winget 安裝。'
  Write-Host '將準備專案後執行 npm install 與 npm run setup:cloudflare。'
  exit 0
}

Write-Step '檢查 Git、Node.js 22+ 與 npm'
$git = Get-Command git -ErrorAction SilentlyContinue
$nodeMajor = Get-NodeMajor
$npm = Get-Command npm -ErrorAction SilentlyContinue
$needsGit = -not $git
$needsNode = $null -eq $nodeMajor -or $nodeMajor -lt 22
$needsNpm = -not $npm

if ($needsGit -or $needsNode -or $needsNpm) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw '找不到 winget。請先從官方網站安裝 Git 與 Node.js 22 LTS，再重新執行此安裝程式。'
  }
  if ($needsGit) {
    Invoke-Checked $winget.Source @('install', '--id', 'Git.Git', '--exact', '--accept-source-agreements', '--accept-package-agreements') 'Git 安裝失敗。'
  }
  if ($needsNode -or $needsNpm) {
    $nodePackageArgs = @('--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-source-agreements', '--accept-package-agreements')
    if ($null -ne $nodeMajor -and $nodeMajor -lt 22) {
      & $winget.Source upgrade @nodePackageArgs
      if ($LASTEXITCODE -ne 0) {
        $installArgs = @('install') + $nodePackageArgs + @('--force')
        Invoke-Checked $winget.Source $installArgs 'Node.js LTS 升級失敗。'
      }
    } else {
      $installArgs = @('install') + $nodePackageArgs + @('--force')
      Invoke-Checked $winget.Source $installArgs 'Node.js LTS 安裝失敗。'
    }
  }
  Refresh-ProcessPath
  $git = Get-Command git -ErrorAction SilentlyContinue
  $nodeMajor = Get-NodeMajor
  $npm = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $git) { throw '找不到 Git，請安裝 Git 後重新執行。' }
if ($null -eq $nodeMajor -or $nodeMajor -lt 22) { throw 'Node.js 版本必須為 22 以上，請安裝 Node.js 22 LTS 後重新執行。' }
if (-not $npm) { throw '找不到 npm，請確認 Node.js 安裝完整後重新執行。' }

Write-Step '確認專案目錄'
if ($scriptIsRepo -and -not $installDirProvided) {
  $repo = $scriptDir
} else {
  if (Test-Path -LiteralPath $target) {
    if (-not (Get-Item -LiteralPath $target).PSIsContainer) { throw "目標路徑不是目錄：$target" }
    $children = @(Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1)
    if ($children.Count -eq 0) {
      Invoke-Checked $git.Source @('clone', 'https://github.com/InchIK/DividendTracker.git', $target) 'Git clone 失敗。'
    } elseif ((Get-JsonPackageName $target) -eq 'dividend-tracker') {
      $repo = $target
    } else {
      throw '目標目錄非空且不是 DividendTracker 專案；為安全起見不會 pull、刪除或覆寫。'
    }
  } else {
    Invoke-Checked $git.Source @('clone', 'https://github.com/InchIK/DividendTracker.git', $target) 'Git clone 失敗。'
  }
  if (-not $repo) { $repo = $target }
}

Write-Step '安裝 npm 相依套件'
Push-Location -LiteralPath $repo
try {
  Invoke-Checked $npm.Source @('install') 'npm install 失敗。'
  Write-Step '設定 Cloudflare、建立 D1、migration 並部署'
  Invoke-Checked $npm.Source @('run', 'setup:cloudflare') 'npm run setup:cloudflare 失敗。'
} finally {
  Pop-Location
}

Write-Host "`n安裝完成：$repo" -ForegroundColor Green
