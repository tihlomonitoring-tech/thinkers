# AWS Migration System Inventory

This inventory captures the current system state before AWS cutover.

## Application Stack

- **Backend**: Node.js + Express, entrypoint at `server.js`.
- **Frontend**: React + Vite, built into `client/dist`.
- **Database driver**: `mssql` in `src/db.js`.
- **Session/auth**: `express-session` cookie-based session in-memory on the API instance.

## API Surface

Primary route modules registered in `server.js`:

- `/api/auth`
- `/api/tenants`
- `/api/users`
- `/api/contractor`
- `/api/command-centre`
- `/api/report-breakdown`
- `/api/tasks`
- `/api/profile-management`
- `/api/progress-reports`
- `/api/action-plans`
- `/api/monthly-performance-reports`
- `/api/recruitment`
- `/api/accounting`

## Database Baseline

- Current database provider: Azure SQL (source of truth before migration).
- Target on AWS: Amazon RDS for SQL Server.
- Existing schema/migration footprint under `scripts/`:
  - `74` SQL files (`*.sql`)
  - `74` runner scripts (`run-*.js`)

### High-Impact Database Domains Detected

- Identity and tenants (`schema.sql`, `user-tenants.sql`, `password-reset-tokens.sql`)
- Contractor operations (`contractor-*.sql`)
- Command centre and inspections (`command-centre-*.sql`)
- Accounting suite (`accounting-*.sql`)
- Recruitment (`recruitment-*.sql`)
- Tracking integration (`tracking-*.sql`)
- Tasks and scheduling (`tasks-*.sql`, `pilot-list-distribution.sql`)

## Runtime Environment Variables

Already in use:

- `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD`, `AZURE_SQL_PORT`
- `AZURE_SQL_CONNECTION_STRING`
- `SESSION_SECRET`
- `FRONTEND_ORIGIN`, `APP_URL`
- `EMAIL_*` variables for SMTP

RDS / SQL Server connection in `src/db.js` (do **not** use `AWS_*` env names in AWS-hosted consoles — reserved):

- `SQLSERVER_HOST`, `SQLSERVER_DATABASE`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`, `SQLSERVER_PORT`
- `SQLSERVER_CONNECTION_STRING`, `SQLSERVER_TRUST_SERVER_CERTIFICATE`
- Legacy: `AWS_SQL_*`, `AZURE_SQL_*`

## Migration Guardrails

- Azure is read-only migration source during move.
- No Azure resources are modified or deleted by AWS rollout.
- Cutover happens only after data validation and smoke tests pass.
