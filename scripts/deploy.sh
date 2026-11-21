#!/usr/bin/env bash
#
# Ships the dashboard to production. The deploy workflow (.github/workflows/ci.yml) runs this; it
# runs the same way by hand from any machine with AWS credentials for the deploy role.
#
#   npm run build && scripts/deploy.sh       upload dist/ as release <short sha> and switch to it
#   scripts/deploy.sh --switch <release>     switch back to an earlier release; uploads nothing
#
# Needs AWS credentials in the environment, and:
#   AWS_REGION           ap-south-2
#   UI_ARTIFACT_BUCKET   the private bucket the instance reads builds from
#   EC2_INSTANCE_ID      i-...
#
# A release is uploaded to s3://$UI_ARTIFACT_BUCKET/ui/<release>.tar.gz, then SSM runs
# /opt/platform/deploy-ui.sh <release> on the instance, which unpacks it and switches nginx over.
# That script, and why the dashboard is served by the API's nginx on the same origin, live in the
# platform repository: deploy/deploy-ui.sh and deploy/README.md, "Dashboard".

set -euo pipefail

: "${AWS_REGION:?set AWS_REGION, e.g. ap-south-2}"
: "${UI_ARTIFACT_BUCKET:?set UI_ARTIFACT_BUCKET}"
: "${EC2_INSTANCE_ID:?set EC2_INSTANCE_ID}"

log() { echo "[deploy] $*"; }

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--switch" ]; then
  RELEASE="${2:?usage: deploy.sh --switch <release>}"
  UPLOAD=0
else
  # The release is named after the commit, and the instance never re-downloads a release it already
  # has. A build of uncommitted changes would therefore take a commit's name for code that commit
  # does not contain, and a later deploy of the real commit would silently keep it.
  if [ -n "$(git status --porcelain)" ]; then
    log "FAILED: the working tree has uncommitted changes. Commit them, or build from a clean checkout."
    exit 1
  fi
  RELEASE=$(git rev-parse --short=7 HEAD)
  UPLOAD=1
fi

# It becomes a directory and an S3 key on the instance, which refuses anything else as well.
case "$RELEASE" in
  .*|*[!A-Za-z0-9._-]*)
    log "FAILED: invalid release name '$RELEASE'"
    exit 1
    ;;
esac

# --- upload ------------------------------------------------------------------
if [ "$UPLOAD" -eq 1 ]; then
  if [ ! -f dist/index.html ]; then
    log "FAILED: no dist/index.html. Run npm run build first."
    exit 1
  fi
  ARCHIVE=$(mktemp)
  trap 'rm -f "$ARCHIVE"' EXIT
  # Paths relative to dist/, so index.html sits at the top of the archive where deploy-ui.sh looks.
  # COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files when this runs by hand on a Mac.
  COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" -C dist .
  log "uploading release $RELEASE ($(du -h "$ARCHIVE" | cut -f1)) to s3://$UI_ARTIFACT_BUCKET/ui/"
  aws s3 cp --only-show-errors "$ARCHIVE" "s3://$UI_ARTIFACT_BUCKET/ui/$RELEASE.tar.gz"
fi

# --- release -----------------------------------------------------------------
log "asking $EC2_INSTANCE_ID to switch to $RELEASE"
CMD_ID=$(aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy-ui $RELEASE" \
  --parameters "commands=['/opt/platform/deploy-ui.sh $RELEASE']" \
  --query Command.CommandId --output text)
log "SSM command: $CMD_ID"

invocation() {
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" \
    --query "$1" --output text
}

# The waiter exits non-zero for every terminal state other than Success, and also while the
# invocation is still being registered, so the real status is read explicitly afterwards.
aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" || true
STATUS=$(invocation Status)

echo "----- instance output -----"
invocation StandardOutputContent
if [ "$STATUS" != "Success" ]; then
  echo "----- instance errors -----"
  invocation StandardErrorContent
  log "FAILED: the instance finished with status $STATUS"
  exit 1
fi
log "released $RELEASE"
