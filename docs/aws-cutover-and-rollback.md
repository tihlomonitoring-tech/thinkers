# AWS Cutover and Rollback Procedure

This procedure ensures migration to AWS without modifying Azure resources.

## T-7 to T-1 Days

- [ ] Complete AWS infra provisioning and API deployment.
- [ ] Execute full-load + CDC and pass validation checks.
- [ ] Run smoke tests from AWS frontend to AWS API + RDS.
- [ ] Set monitoring dashboards and alarms:
  - ALB HTTP 5xx
  - ECS task restart count
  - API latency p95
  - RDS CPU, FreeStorageSpace, DatabaseConnections

## T-0 Cutover Window

### Step 1 - Change Freeze

- [ ] Announce read/write freeze window.
- [ ] Pause non-essential background jobs if required.

### Step 2 - Final Data Sync

- [ ] Ensure DMS latency is near zero.
- [ ] Stop writes at application layer.
- [ ] Wait until replication catches up fully.

### Step 3 - DNS Switch

- [ ] Point production DNS to AWS CloudFront/ALB target.
- [ ] Reduce DNS TTL before change; restore later.

### Step 4 - Live Verification (First 30 Minutes)

- [ ] Confirm login, tenant access, and dashboard loading.
- [ ] Validate write paths (create/update in core modules).
- [ ] Watch error logs and alarm state continuously.

## Decision Gates

### Go/No-Go (Immediate)

Go only if:

- Error rate remains within baseline.
- DB connectivity is stable.
- No critical auth or write failures.

### Stabilization (24-48 Hours)

- Maintain heightened monitoring.
- Keep Azure environment available as fallback.

## Rollback Procedure

Rollback trigger examples:

- sustained API 5xx above threshold,
- failed critical workflows,
- data integrity mismatch.

Rollback steps:

1. Re-point DNS back to prior Azure-hosted endpoint.
2. Confirm user traffic resumes on previous environment.
3. Keep AWS environment available for forensic review.
4. Publish incident report and remediation plan before retry.

## Success Criteria

- 24-48h stable traffic on AWS.
- No unresolved severity-1 or severity-2 defects.
- Data integrity checks continue to pass post-cutover.
