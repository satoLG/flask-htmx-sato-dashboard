#!/usr/bin/env bash
# Installed at ~/.hermes/scripts/update-dashboard.sh for Hermes's no-agent cron.
set -Eeuo pipefail

repo=${DASHBOARD_REPO:-/home/leona/projects/hermes-dashboard}
source_url=${DASHBOARD_SOURCE_URL:-https://github.com/satoLG/sato-agents-lab.git}
service=${DASHBOARD_SERVICE:-hermes-dashboard.service}
lock=${DASHBOARD_UPDATE_LOCK:-/home/leona/.hermes/cron/update-dashboard.lock}

die() { printf 'Dashboard update failed: %s\n' "$*" >&2; exit 1; }
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -n 9 || exit 0

cd "$repo" || die "repository not found: $repo"
[[ $(git branch --show-current) == main ]] || die 'checkout is not on main'
[[ -z $(git status --porcelain --untracked-files=no) ]] || die 'tracked files have local changes'
old=$(git rev-parse HEAD)

# Fetch the repository directly; this operation needs Git, not the GitHub API
# or an inference provider. Short outages are retried without touching the site.
fetched=false
for attempt in 1 2 3; do
  if timeout 90 git fetch --no-tags "$source_url" refs/heads/main; then
    fetched=true
    break
  fi
  [[ $attempt == 3 ]] || sleep $((attempt * 3))
done
[[ $fetched == true ]] || die 'could not fetch main after three attempts'
new=$(git rev-parse FETCH_HEAD)
[[ $new != "$old" ]] || exit 0
git merge-base --is-ancestor "$old" "$new" || die 'remote main is not a fast-forward of the deployed version'

# Check the candidate in isolation, while the running checkout stays intact.
candidate=$(mktemp -d /tmp/hermes-dashboard-update.XXXXXXXX)
trap 'rm -rf -- "$candidate"' EXIT
git archive "$new" | tar -x -C "$candidate" || die 'could not stage candidate'
python="$repo/venv/bin/python"
[[ -x $python ]] || die 'dashboard virtual environment is missing'
(cd "$candidate" && "$python" -m compileall -q app.py hermes_dashboard && "$python" tools/check_html.py >/dev/null && "$python" -c 'from app import app; assert app.test_client().get("/lab").status_code == 200') || die 'candidate validation failed'

git merge --ff-only "$new" || die 'fast-forward failed'
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
if ! systemctl --user restart "$service"; then
  git reset --hard "$old" >/dev/null
  systemctl --user restart "$service" || true
  die 'service restart failed; restored previous revision'
fi

healthy=false
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/lab -o /dev/null 2>/dev/null &&
     curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8080/api/lab/state -o /dev/null 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ $healthy != true ]]; then
  git reset --hard "$old" >/dev/null
  systemctl --user restart "$service" || true
  die 'health check failed; restored previous revision'
fi
printf 'Dashboard updated: %s -> %s; /lab and /api/lab/state healthy.\n' "${old:0:8}" "${new:0:8}"
