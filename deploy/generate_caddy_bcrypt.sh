#!/usr/bin/env bash
set -euo pipefail

DEFAULT_USERNAME="SwustStudent"

username="${1:-$DEFAULT_USERNAME}"
password="${2:-}"

if ! command -v caddy >/dev/null 2>&1; then
    echo "ERROR: caddy is not installed or not on PATH." >&2
    echo "Install Caddy first, then rerun this script on the server." >&2
    exit 1
fi

if [[ -z "$password" ]]; then
    read -r -s -p "Password for ${username}: " password
    echo
fi

if [[ -z "$password" ]]; then
    echo "ERROR: password cannot be empty." >&2
    exit 1
fi

hash="$(caddy hash-password --plaintext "$password")"

cat <<EOF
Generated Caddy bcrypt hash for user: ${username}

Paste this block into your Caddyfile:

basic_auth {
    ${username} ${hash}
}
EOF
