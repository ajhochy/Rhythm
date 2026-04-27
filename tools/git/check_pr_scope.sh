#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

BASE_REF="${BASE_REF:-}"
EXPECT_AREA=""
ALLOW_MULTI_AREA=0

usage() {
  cat <<'EOF'
Usage: tools/git/check_pr_scope.sh [--base <ref>] [--expect-area <area>] [--allow-multi-area]

Areas:
  backend   apps/api_server plus backend-focused docs/tests
  desktop   apps/desktop_flutter plus desktop-focused docs/tests
  release   .github/workflows, tools/release, macOS packaging/signing files, release docs
  docs      docs-only changes

The command prints the changed files relative to the merge-base with the base ref.
When --expect-area is provided, it fails if files outside that area are present.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="${2:-}"
      shift 2
      ;;
    --expect-area)
      EXPECT_AREA="${2:-}"
      shift 2
      ;;
    --allow-multi-area)
      ALLOW_MULTI_AREA=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

resolve_default_base() {
  if [[ -n "${BASE_REF}" ]]; then
    printf '%s\n' "${BASE_REF}"
    return
  fi

  if git show-ref --verify --quiet refs/remotes/origin/main; then
    printf '%s\n' "origin/main"
    return
  fi

  if git show-ref --verify --quiet refs/heads/main; then
    printf '%s\n' "main"
    return
  fi

  echo "Unable to find a default base ref. Pass --base <ref>." >&2
  exit 1
}

matches_area() {
  local area="$1"
  local path="$2"

  case "${area}" in
    backend)
      [[ "${path}" == apps/api_server/* ]] && return 0
      [[ "${path}" == docs/engineering/api-contracts.md ]] && return 0
      [[ "${path}" == docs/engineering/mvc-guidelines.md ]] && return 0
      [[ "${path}" == docs/engineering/data-model.md ]] && return 0
      [[ "${path}" == docs/engineering/architecture.md ]] && return 0
      [[ "${path}" == docs/release/hosted_deployment_synology_cloudflare.md ]] && return 0
      ;;
    desktop)
      [[ "${path}" == apps/desktop_flutter/* ]] && return 0
      [[ "${path}" == docs/release/macos_distribution.md ]] && return 0
      [[ "${path}" == docs/plans/google-oauth-* ]] && return 0
      [[ "${path}" == docs/product/facilities-v1.md ]] && return 0
      ;;
    release)
      [[ "${path}" == .github/workflows/* ]] && return 0
      [[ "${path}" == tools/release/* ]] && return 0
      [[ "${path}" == apps/desktop_flutter/macos/* ]] && return 0
      [[ "${path}" == docs/release/* ]] && return 0
      [[ "${path}" == docs/plans/google-oauth-* ]] && return 0
      ;;
    docs)
      [[ "${path}" == docs/* ]] && return 0
      ;;
    *)
      echo "Unknown area '${area}'. Expected backend, desktop, release, or docs." >&2
      exit 1
      ;;
  esac

  [[ "${path}" == .github/PULL_REQUEST_TEMPLATE.md ]] && return 0
  [[ "${path}" == tools/git/check_pr_scope.sh ]] && return 0

  return 1
}

classify_path() {
  local path="$1"
  case "${path}" in
    apps/api_server/*) printf 'backend\n' ;;
    apps/desktop_flutter/*) printf 'desktop\n' ;;
    .github/workflows/*|tools/release/*) printf 'release\n' ;;
    docs/*) printf 'docs\n' ;;
    tools/*) printf 'tools\n' ;;
    .github/*) printf 'github\n' ;;
    *) printf 'other\n' ;;
  esac
}

BASE_REF="$(resolve_default_base)"
MERGE_BASE="$(git merge-base HEAD "${BASE_REF}")"
CHANGED_FILES=()
while IFS= read -r path; do
  CHANGED_FILES+=("${path}")
done < <(git diff --name-only "${MERGE_BASE}"...HEAD)

if [[ "${#CHANGED_FILES[@]}" -eq 0 ]]; then
  echo "No changes detected relative to ${BASE_REF}."
  exit 0
fi

backend_count=0
desktop_count=0
release_count=0
docs_count=0
tools_count=0
github_count=0
other_count=0

for path in "${CHANGED_FILES[@]}"; do
  area="$(classify_path "${path}")"
  case "${area}" in
    backend) backend_count=$((backend_count + 1)) ;;
    desktop) desktop_count=$((desktop_count + 1)) ;;
    release) release_count=$((release_count + 1)) ;;
    docs) docs_count=$((docs_count + 1)) ;;
    tools) tools_count=$((tools_count + 1)) ;;
    github) github_count=$((github_count + 1)) ;;
    other) other_count=$((other_count + 1)) ;;
  esac
done

echo "PR scope check against ${BASE_REF}"
echo "Merge base: ${MERGE_BASE}"
echo "Changed files: ${#CHANGED_FILES[@]}"
echo
[[ "${backend_count}" -gt 0 ]] && echo "  backend: ${backend_count}"
[[ "${desktop_count}" -gt 0 ]] && echo "  desktop: ${desktop_count}"
[[ "${release_count}" -gt 0 ]] && echo "  release: ${release_count}"
[[ "${docs_count}" -gt 0 ]] && echo "  docs: ${docs_count}"
[[ "${tools_count}" -gt 0 ]] && echo "  tools: ${tools_count}"
[[ "${github_count}" -gt 0 ]] && echo "  github: ${github_count}"
[[ "${other_count}" -gt 0 ]] && echo "  other: ${other_count}"

echo
printf '%s\n' "${CHANGED_FILES[@]}"

if [[ -n "${EXPECT_AREA}" ]]; then
  violations=()
  for path in "${CHANGED_FILES[@]}"; do
    if ! matches_area "${EXPECT_AREA}" "${path}"; then
      violations+=("${path}")
    fi
  done

  if [[ "${#violations[@]}" -gt 0 ]]; then
    echo
    echo "Scope check failed for expected area '${EXPECT_AREA}'." >&2
    printf '%s\n' "${violations[@]}" >&2
    exit 1
  fi
fi

active_areas=0
[[ "${backend_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${desktop_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${release_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${docs_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${tools_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${github_count}" -gt 0 ]] && active_areas=$((active_areas + 1))
[[ "${other_count}" -gt 0 ]] && active_areas=$((active_areas + 1))

if [[ "${active_areas}" -gt 3 && "${ALLOW_MULTI_AREA}" -ne 1 ]]; then
  echo
  echo "Scope check warning: this branch spans ${active_areas} areas." >&2
  echo "Re-run with --allow-multi-area if the breadth is intentional." >&2
  exit 1
fi

echo
echo "PR scope check passed."
