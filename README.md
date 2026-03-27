# Thinkers App

A new app by tihlomonitoring-tech.

## Setup

```bash
git clone https://github.com/tihlomonitoring-tech/thinkers.git
cd thinkers
npm install
```

## Azure SQL Database

1. Copy env example and add your Azure SQL details:

   ```bash
   cp .env.example .env
   ```

2. In `.env`, either set a full connection string:

   ```
   AZURE_SQL_CONNECTION_STRING=Server=YOUR_SERVER.database.windows.net,1433;Database=YOUR_DB;User Id=YOUR_USER;Password=YOUR_PASSWORD;Encrypt=true;TrustServerCertificate=false
   ```

   Or set individual variables:

   ```
   AZURE_SQL_SERVER=YOUR_SERVER.database.windows.net
   AZURE_SQL_DATABASE=YOUR_DATABASE
   AZURE_SQL_USER=YOUR_USER
   AZURE_SQL_PASSWORD=YOUR_PASSWORD
   AZURE_SQL_PORT=1433
   ```

3. In Azure Portal: ensure your client IP is allowed (SQL server → Networking / Firewall rules). Do not commit `.env` or any secrets.

## Multi-tenant app (User & Tenant Management)

1. **Apply database schema and seed**
   ```bash
   npm run db:schema   # creates tenants, users, audit_log
   npm run db:contractor  # creates contractor tables (trucks, drivers, incidents, expiries, suspensions, messages)
   npm run seed        # creates first tenant + super admin: admin@thinkers.africa / Admin123!
   ```

2. **Start the API server**
   ```bash
   npm run server      # http://localhost:3001
   npm run server:dev  # with watch
   ```

3. **Start the frontend** (in another terminal)
   ```bash
   cd client && npm install && npm run dev   # http://localhost:5173
   ```

4. Sign in at http://localhost:5173 with `admin@thinkers.africa` / `Admin123!` (change password after first login).

Optional in `.env`: `SESSION_SECRET`, `PORT`, `FRONTEND_ORIGIN`.

## Development

```bash
npm run dev    # run DB connection test with watch
npm start      # run DB connection test once
```

The app runs a quick connection test on startup (`SELECT 1`). Use `src/db.js` for `getPool()`, `query()`, and `close()` in your code.

## Tracking & integration (roadmap)

Planned follow-ups (telematics jobs, maps, secret encryption, SA provider connectors such as Car Track, FleetCam, Nestar, Tracker, Bitrack, Ctrack, etc.) are described in **`docs/TRACKING-INTEGRATION-ROADMAP.md`**. Apply DB objects with `npm run db:tracking-setup` after pulling changes.

**Tracking demo:** after `db:tracking-setup`, run `npm run db:tracking-mock` to seed three mock trucks; open **Tracking → Fleet movement** for the Leaflet map and optional **Live updates** (MOCK trips only).

## AWS migration assets

AWS migration implementation artifacts are now available in this repository:

- Architecture and migration docs in `docs/aws-*.md`
- Terraform bootstrap in `infra/terraform`
- API container build in `Dockerfile`
- Deploy helpers:
  - `scripts/aws/build-and-push-api.sh`
  - `scripts/aws/sync-frontend-to-s3.sh`

Start with:

1. `docs/aws-system-inventory.md`
2. `docs/aws-target-architecture.md`
3. `docs/aws-cost-estimates.md`
4. `docs/aws-db-migration-runbook.md`
5. `docs/aws-cutover-and-rollback.md`
