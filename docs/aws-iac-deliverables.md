# IaC and Deployment Deliverables

This document tracks what has been implemented for AWS migration.

## Implemented In This Repo

- `infra/terraform/main.tf`
  - VPC, subnets, internet gateway, route table
  - Security groups for ALB/ECS/RDS traffic boundaries
  - RDS SQL Server instance baseline
  - Secrets Manager secret baseline for app runtime vars
  - ECR repository
  - S3 bucket for frontend artifacts
- `infra/terraform/variables.tf`
  - Environment and security defaults
  - DB sizing and configuration variables
  - App runtime variable definitions
- `infra/terraform/outputs.tf`
  - Endpoint and artifact outputs
- `infra/terraform/terraform.tfvars.example`
  - Safe starter values for non-production planning
- `Dockerfile`
  - Build backend + frontend bundle for ECS runtime image
- `scripts/aws/build-and-push-api.sh`
  - Build and push API container to ECR
- `scripts/aws/sync-frontend-to-s3.sh`
  - Publish frontend to S3 and invalidate CloudFront

## Documentation Delivered

- `docs/aws-system-inventory.md`
- `docs/aws-target-architecture.md`
- `docs/aws-cost-estimates.md`
- `docs/aws-db-migration-runbook.md`
- `docs/aws-cutover-and-rollback.md`
- `docs/aws-env-mapping.md`

## Next Implementation Layer (When You Confirm Provisioning)

- ECS cluster/service/task definition resources
- ALB listener, target group, HTTPS certificate wiring
- CloudFront distribution + Route53 DNS records
- DMS resources (replication instance/endpoints/task) as code
- CI/CD pipeline integration for automated image + frontend deploy
