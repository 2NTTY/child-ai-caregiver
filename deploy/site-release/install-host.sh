#!/usr/bin/env bash
# Run on the original VM as an infrastructure operator, after reviewing the checkout.
set -euo pipefail
test "$(id -u)" = 0
cd "$(dirname "$0")"
target=/usr/local/lib/yuyoufang-site-release
install -d -m 0755 "$target"
install -d -m 0700 /var/lib/yuyoufang-site-release
# Serialize operator installs. The receiver takes its own process lock during adoption.
exec 8>/run/lock/yuyoufang-site-release-install.lock
flock -n 8
systemctl stop site-release.timer 2>/dev/null || true
if systemctl is-active --quiet site-release.service; then
  echo 'A release is active; wait for its receipt before updating the receiver.' >&2
  systemctl start site-release.timer
  exit 1
fi
files=(protocol.py store.py host.py activity.sh site-release.service site-release.timer)
previous=$(mktemp -d /var/lib/yuyoufang-site-release/receiver-backup.XXXXXX)
for file in "${files[@]}"; do
  if [[ -f "$target/$file" ]]; then install -m 0644 "$target/$file" "$previous/$file"; fi
  install -m 0644 "$file" "$target/$file.new"
done
for file in "${files[@]}"; do mv -f "$target/$file.new" "$target/$file"; done
if ! python3 "$target/host.py" adopt; then
  if [[ -f "$previous/host.py" ]]; then
    for file in "${files[@]}"; do install -m 0644 "$previous/$file" "$target/$file"; done
    systemctl start site-release.timer
  fi
  exit 1
fi
install -m 0644 site-release.service site-release.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now site-release.timer
