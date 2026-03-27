# AWS Cost Estimates (Planning Baseline)

All values are planning estimates in USD/month and should be revalidated in AWS Pricing Calculator before purchase. Estimates assume `af-south-1` may be higher than `us-east-1`.

## Assumptions

- Backend API runs continuously on ECS Fargate.
- SQL Server is license-included on RDS.
- Frontend is static in S3 + CloudFront.
- Data transfer shown as modest baseline and can vary significantly with traffic.

## Dev/Staging Profile (Cost-Optimized)

- ECS Fargate: `1` task (`0.5 vCPU / 1 GB`) -> `$22 - $40`
- ALB: `1` ALB, low traffic -> `$20 - $35`
- RDS SQL Server Express (`db.t3.small`, Single-AZ, 50 GB gp3) -> `$140 - $260`
- S3 (20 GB + requests) -> `$1 - $4`
- CloudFront (200 GB egress + requests) -> `$18 - $35`
- CloudWatch logs/metrics/alarms -> `$5 - $20`
- Secrets Manager + KMS API usage -> `$2 - $8`
- AWS DMS during migration window (small instance) -> `$20 - $80`

**Estimated total (dev/staging):** `$228 - $482` / month  
**After migration (DMS removed):** `$208 - $402` / month

## Production Profile (Resilience-Focused)

- ECS Fargate: `2-3` tasks (`1 vCPU / 2 GB`) -> `$90 - $240`
- ALB: moderate traffic -> `$30 - $80`
- RDS SQL Server Standard (`db.m5.large`, Multi-AZ, 200 GB gp3) -> `$700 - $1,900`
- S3 (100 GB + requests) -> `$3 - $15`
- CloudFront (1-2 TB egress + requests) -> `$85 - $240`
- CloudWatch + alarms + retention -> `$20 - $120`
- Secrets Manager + KMS -> `$5 - $20`
- AWS Backup snapshots (RDS retention) -> `$20 - $120`

**Estimated total (production):** `$953 - $2,735` / month

## Cost Risk Drivers

- SQL Server edition/instance family is the largest driver.
- Multi-AZ doubles significant portions of DB spend.
- CloudFront egress dominates when usage spikes.
- Fargate task count can rise with autoscaling settings.

## Immediate Cost Controls

- Start with SQL Server Express in non-prod.
- Keep one ECS task until session externalization is completed.
- Set CloudWatch log retention policy (`14-30` days) initially.
- Use S3 lifecycle rules for frontend and exports where possible.
