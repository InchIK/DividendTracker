#!/usr/bin/env bash
set -Eeuo pipefail

dry_run=0
install_dir=''
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -*)
      printf '未知參數：%s\n' "$arg" >&2
      exit 2
      ;;
    *)
      if [[ -n "$install_dir" ]]; then
        printf '只能指定一個安裝目錄。\n' >&2
        exit 2
      fi
      install_dir="$arg"
      ;;
  esac
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
is_dividend_repo() {
  local directory="$1"
  [[ -f "$directory/package.json" ]] \
    && grep -Eq '"name"[[:space:]]*:[[:space:]]*"dividend-tracker"' "$directory/package.json"
}

script_is_repo=0
if is_dividend_repo "$script_dir"; then script_is_repo=1; fi
install_dir_provided=0
if [[ -n "$install_dir" ]]; then install_dir_provided=1; fi
if [[ -z "$install_dir" ]]; then
  if (( script_is_repo == 1 )); then
    install_dir="$script_dir"
  else
    install_dir="${HOME}/DividendTracker"
  fi
fi
target="$(cd -- "$(dirname -- "$install_dir")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename -- "$install_dir")" || printf '%s' "$install_dir")"

if (( dry_run == 1 )); then
  printf 'DryRun：只顯示安裝計畫，不會安裝軟體、連網、clone、建立目錄或修改檔案。\n'
  printf '目標目錄：%s\n' "$target"
  printf '將檢查 curl、git、Node.js 22+ 與 npm，必要時使用系統套件管理器或 nvm。\n'
  printf '將準備專案後執行 npm install 與 npm run setup:cloudflare。\n'
  exit 0
fi

step() { printf '\n==> %s\n' "$1"; }
run_checked() {
  if "$@"; then
    return 0
  else
    local status=$?
    printf '指令失敗，設定已安全停止：%s\n' "$1" >&2
    return "$status"
  fi
}

step '檢查 curl 與 git'
install_system_tools() {
  local manager=''
  if command -v apt-get >/dev/null 2>&1; then manager='apt-get'
  elif command -v dnf >/dev/null 2>&1; then manager='dnf'
  elif command -v yum >/dev/null 2>&1; then manager='yum'
  elif command -v pacman >/dev/null 2>&1; then manager='pacman'
  elif command -v zypper >/dev/null 2>&1; then manager='zypper'
  fi
  if [[ -z "$manager" ]]; then
    printf '找不到支援的套件管理器（apt-get、dnf、yum、pacman 或 zypper）。請先安裝 git、curl 與 ca-certificates。\n' >&2
    return 1
  fi
  local -a elevate=()
  if [[ "$(id -u)" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      printf '目前不是 root 且找不到 sudo；請先安裝 git、curl 與 ca-certificates。\n' >&2
      return 1
    fi
    elevate=(sudo)
  fi
  case "$manager" in
    apt-get)
      run_checked "${elevate[@]}" apt-get update
      run_checked "${elevate[@]}" apt-get install -y git curl ca-certificates
      ;;
    dnf|yum)
      run_checked "${elevate[@]}" "$manager" install -y git curl ca-certificates
      ;;
    pacman)
      run_checked "${elevate[@]}" pacman -Sy --noconfirm git curl ca-certificates
      ;;
    zypper)
      run_checked "${elevate[@]}" zypper --non-interactive install git curl ca-certificates
      ;;
  esac
}

if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  install_system_tools
fi
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  printf '仍找不到 curl 或 git，請安裝後重新執行。\n' >&2
  exit 1
fi

node_major=''
if command -v node >/dev/null 2>&1; then
  node_version="$(node --version 2>/dev/null || true)"
  if [[ "$node_version" =~ ^v([0-9]+)\. ]]; then node_major="${BASH_REMATCH[1]}"; fi
fi

nvm_tmp_dir=''
nvm_tmp_created=0
cleanup_nvm_tmp() {
  if [[ "${nvm_tmp_created:-0}" -eq 1 && -n "${nvm_tmp_dir:-}" ]]; then
    case "$nvm_tmp_dir" in
      /tmp/dividend-tracker-nvm.*|"${TMPDIR:-/tmp}"/dividend-tracker-nvm.*)
        if [[ -d "$nvm_tmp_dir" && -n "$(find "$nvm_tmp_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
          rm -rf -- "$nvm_tmp_dir"
        elif [[ -d "$nvm_tmp_dir" ]]; then
          rmdir -- "$nvm_tmp_dir" 2>/dev/null || true
        fi
        ;;
      *)
        printf '拒絕清理未由 mktemp 建立的暫存路徑：%s\n' "$nvm_tmp_dir" >&2
        ;;
    esac
  fi
}
trap cleanup_nvm_tmp EXIT

if [[ -z "$node_major" || "$node_major" -lt 22 ]] || ! command -v npm >/dev/null 2>&1; then
  step '安裝 Node.js 22（nvm）'
  nvm_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dividend-tracker-nvm.XXXXXX")"
  nvm_tmp_created=1
  nvm_installer="$nvm_tmp_dir/install.sh"
  run_checked curl -fsSL --output "$nvm_installer" 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh'
  if [[ ! -s "$nvm_installer" ]]; then
    printf 'nvm 安裝檔下載為空，已停止。\n' >&2
    exit 1
  fi
  run_checked bash "$nvm_installer"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    printf '找不到 nvm.sh，Node.js 安裝失敗。\n' >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh"
  run_checked nvm install 22
  run_checked nvm alias default 22
  run_checked nvm use 22
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '找不到 node 或 npm，請安裝 Node.js 22 LTS 後重新執行。\n' >&2
  exit 1
fi
node_version="$(node --version)"
if [[ ! "$node_version" =~ ^v([0-9]+)\. ]] || (( BASH_REMATCH[1] < 22 )); then
  printf 'Node.js 版本必須為 22 以上，請安裝 Node.js 22 LTS 後重新執行。\n' >&2
  exit 1
fi

step '確認專案目錄'
repo=''
if (( script_is_repo == 1 && install_dir_provided == 0 )); then
  repo="$script_dir"
else
  if [[ -e "$target" ]]; then
    if [[ ! -d "$target" ]]; then
      printf '目標路徑不是目錄：%s\n' "$target" >&2
      exit 1
    fi
    if [[ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      run_checked git clone 'https://github.com/InchIK/DividendTracker.git' "$target"
    elif is_dividend_repo "$target"; then
      repo="$target"
    else
      printf '目標目錄非空且不是 DividendTracker 專案；為安全起見不會 pull、刪除或覆寫。\n' >&2
      exit 1
    fi
  else
    run_checked git clone 'https://github.com/InchIK/DividendTracker.git' "$target"
  fi
  if [[ -z "$repo" ]]; then repo="$target"; fi
fi

step '安裝 npm 相依套件'
pushd "$repo" >/dev/null
run_checked npm install
step '設定 Cloudflare、建立 D1、migration 並部署'
run_checked npm run setup:cloudflare
popd >/dev/null
printf '\n安裝完成：%s\n' "$repo"
