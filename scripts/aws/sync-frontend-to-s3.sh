#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <s3-bucket-name> <cloudfront-distribution-id>"
  exit 1
fi

BUCKET_NAME="$1"
DISTRIBUTION_ID="$2"

echo "Building frontend..."
npm run build --prefix client

echo "Syncing client/dist to s3://$BUCKET_NAME ..."
aws s3 sync client/dist "s3://$BUCKET_NAME" --delete

echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"

echo "Frontend deploy complete."
