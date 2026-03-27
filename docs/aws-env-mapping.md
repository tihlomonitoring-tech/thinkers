# Environment Variable Mapping (Azure -> AWS)

Use this mapping during deployment. Azure keys stay supported for rollback parity. On **AWS-hosted runtimes** (App Runner, Amplify hosting env, Lambda, etc.), **do not** use environment variable names starting with `AWS_` — that prefix is **reserved** by the platform. Use **`SQLSERVER_*`** instead.

| Azure / legacy | Preferred on AWS | Notes |
|---|---|---|
| `AZURE_SQL_SERVER` | `SQLSERVER_HOST` | RDS endpoint hostname |
| `AZURE_SQL_DATABASE` | `SQLSERVER_DATABASE` | Database name on RDS SQL Server |
| `AZURE_SQL_USER` | `SQLSERVER_USER` | SQL login |
| `AZURE_SQL_PASSWORD` | `SQLSERVER_PASSWORD` | SQL password |
| `AZURE_SQL_PORT` | `SQLSERVER_PORT` | Default `1433` |
| `AZURE_SQL_CONNECTION_STRING` | `SQLSERVER_CONNECTION_STRING` | Optional alternative to discrete vars |

**Deprecated (still read by the app):** `AWS_SQL_*` — use only for local `.env` if needed; **not** in AWS console environment variables.

| Other | Same name | Notes |
|---|---|---|
| `SESSION_SECRET` | `SESSION_SECRET` | |
| `FRONTEND_ORIGIN` | `FRONTEND_ORIGIN` | CloudFront/app domain |
| `APP_URL` | `APP_URL` | Public URL for links |
| `EMAIL_*` | `EMAIL_*` | SMTP (not `AWS_*` reserved) |

## Secret Layout Recommendation

Store one JSON secret in AWS Secrets Manager (example key: `thinkers/<env>/app-env`) with keys such as `SQLSERVER_HOST`, `SQLSERVER_DATABASE`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`, `SQLSERVER_PORT`, matching what [`infra/terraform/main.tf`](../infra/terraform/main.tf) outputs for the app container.
