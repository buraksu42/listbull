#!/bin/bash
# Install a pre-commit hook that runs gitleaks on staged changes.
# Usage: bash scripts/install-gitleaks-hook.sh
#
# Requires gitleaks installed locally:
#   - macOS: brew install gitleaks
#   - Linux: download from https://github.com/gitleaks/gitleaks/releases

set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not found in PATH. Install it first:"
  echo "  macOS: brew install gitleaks"
  echo "  Linux: see https://github.com/gitleaks/gitleaks/releases"
  exit 1
fi

HOOK_DIR="$(git rev-parse --git-dir)/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

cat > "$HOOK_FILE" <<'EOF'
#!/bin/sh
# pre-commit: scan staged changes for leaked secrets.
# Bypass with `git commit --no-verify` only if you know what you're doing.
exec gitleaks protect --staged --redact --no-banner --config .gitleaks.toml
EOF

chmod +x "$HOOK_FILE"
echo "Installed pre-commit hook at $HOOK_FILE"
echo "Test: stage something containing 'sk-or-v1-' and try to commit — it should be blocked."
