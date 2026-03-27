#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <aws-region> <ecr-repo-url> [image-tag]"
  exit 1
fi

AWS_REGION="$1"
ECR_REPO_URL="$2"
IMAGE_TAG="${3:-$(date +%Y%m%d%H%M%S)}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_REPO_URL%/*}"

echo "Building image..."
docker build -t thinkers-api:"$IMAGE_TAG" .

echo "Tagging image..."
docker tag thinkers-api:"$IMAGE_TAG" "$ECR_REPO_URL:$IMAGE_TAG"

echo "Pushing image..."
docker push "$ECR_REPO_URL:$IMAGE_TAG"

echo "Done. Pushed: $ECR_REPO_URL:$IMAGE_TAG"
