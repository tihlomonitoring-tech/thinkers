# Azure SQL to AWS RDS SQL Server Migration Runbook

This runbook migrates data to AWS while leaving Azure untouched.

## Migration Strategy

Primary path:

1. Provision RDS SQL Server target.
2. Build schema baseline from existing SQL scripts in `scripts/`.
3. Run AWS DMS **full load + CDC** from Azure SQL (source) to RDS SQL Server (target).
4. Validate data quality and app behavior.
5. Execute final sync during cutover window.

Fallback path when CDC is unavailable:

1. Full load via DMS.
2. Scheduled incremental sync jobs by table/time watermark.
3. Final write freeze and delta sync before cutover.

## Pre-Migration Checklist

- [ ] RDS endpoint reachable from DMS replication instance.
- [ ] SQL credentials created for source and target.
- [ ] Network paths open: DMS -> Azure SQL `1433`, DMS -> RDS `1433`.
- [ ] Source database compatibility validated with SQL Server target engine version.
- [ ] Initial schema created on RDS (tables, keys, indexes required by app).

## DMS Task Design

- Migration type: **Migrate existing data and replicate ongoing changes**
- Table mappings: include all application schemas/tables.
- LOB handling: Limited LOB mode first; switch to full LOB if validation requires.
- Validation mode: enabled where supported.
- Task logging: CloudWatch enabled.

## Validation Checkpoints

### Checkpoint A - Structural Validation

- [ ] Table counts match (source vs target object count).
- [ ] Primary keys and critical indexes exist on target.
- [ ] Identity/sequence behavior verified for insert-heavy tables.

### Checkpoint B - Data Validation

- [ ] Row counts match for each table.
- [ ] Sampled checksum/hash verification for key business tables:
  - users/tenants/auth tables
  - contractor and incidents tables
  - accounting documents and line items
  - tasks and schedules
  - tracking integration tables
- [ ] Nullability and constraint violations checked.

### Checkpoint C - Application Validation

- [ ] API health endpoint returns healthy on AWS runtime.
- [ ] Authentication and session login works.
- [ ] CRUD smoke tests pass for contractor, accounting, tasks, tracking modules.
- [ ] No SQL syntax/runtime errors against RDS logs.

## SQL Validation Queries (Examples)

```sql
-- Count check pattern
SELECT COUNT(*) AS total_rows FROM dbo.users;

-- Date-window spot check pattern
SELECT TOP 100 * FROM dbo.accounting_documentation_versions ORDER BY created_at DESC;
```

## Cutover Readiness Gate

Proceed only when all are true:

- DMS task healthy and low-latency replication.
- Validation checkpoints A/B/C passed.
- Rollback path tested (DNS re-point and Azure API endpoint still valid).

## Post-Cutover

- Keep DMS running briefly to monitor divergence risk.
- Disable replication after stabilization window.
- Keep Azure source intact and untouched until formal decommission decision.
