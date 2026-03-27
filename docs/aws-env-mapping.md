# Environment Variable Mapping (Azure -> AWS)

Use this mapping during deployment. Azure keys stay supported for rollback parity; AWS keys are preferred for AWS runtime.

| Current key | AWS runtime key | Notes |
|---|---|---|
| `AZURE_SQL_SERVER` | `AWS_SQL_SERVER` | RDS endpoint hostname |
| `AZURE_SQL_DATABASE` | `AWS_SQL_DATABASE` | Database name on RDS SQL Server |
| `AZURE_SQL_USER` | `AWS_SQL_USER` | SQL login |
| `AZURE_SQL_PASSWORD` | `AWS_SQL_PASSWORD` | SQL password |
| `AZURE_SQL_PORT` | `AWS_SQL_PORT` | Default `1433` |
| `AZURE_SQL_CONNECTION_STRING` | `AWS_SQL_CONNECTION_STRING` | Optional alternative to discrete vars |
| `SESSION_SECRET` | `SESSION_SECRET` | Keep same key name |
| `FRONTEND_ORIGIN` | `FRONTEND_ORIGIN` | CloudFront/app domain |
| `APP_URL` | `APP_URL` | Public URL for links |
| `EMAIL_USER` | `EMAIL_USER` | SMTP user |
| `EMAIL_PASS` | `EMAIL_PASS` | SMTP password/app password |
| `EMAIL_FROM_NAME` | `EMAIL_FROM_NAME` | Sender display name |
| `EMAIL_HOST` | `EMAIL_HOST` | Optional SMTP host |
| `EMAIL_PORT` | `EMAIL_PORT` | Optional SMTP port |
| `EMAIL_SECURE` | `EMAIL_SECURE` | Optional SMTP TLS flag |

## Secret Layout Recommendation

Store one JSON secret in AWS Secrets Manager (example key: `thinkers/<env>/app-env`) containing all runtime keys consumed by the API container.
