# Hosting the Thinkers app on Azure

This guide covers running both the **backend** (and optionally the **frontend**) on Azure and connecting to **Azure SQL Database**.

---

## 1. Overview

| Part | Where it runs | What to configure |
|------|----------------|-------------------|
| **Backend** (Node/Express) | Azure App Service (Web App) | App Service env vars → Azure SQL + `SESSION_SECRET` |
| **Frontend** (Vite/React) | Same App Service (static) or Azure Static Web Apps | If separate: set `VITE_API_BASE` to your API URL at build time |
| **Database** | Azure SQL Database | Connection details in backend env vars; firewall allows App Service |

Because both the app and the database are on Azure, you can enable **Allow Azure services and resources to access this server** on the SQL server firewall so the App Service can connect without opening to the whole internet.

---

## 2. Azure SQL Database

1. In [Azure Portal](https://portal.azure.com), create or use an **Azure SQL server** and **database**.
2. Create a **SQL login** (user + password) and ensure that user has access to your database.
3. **Firewall**: SQL server → **Networking** (or **Firewall and virtual networks**):
   - Turn on **Allow Azure services and resources to access this server** so your App Service can connect.
   - For local development, add your own client IP.
4. Note:
   - **Server**: e.g. `yourserver.database.windows.net`
   - **Database name**
   - **User** and **Password**

---

## 3. Backend on Azure App Service

### Deploy the Node API

- Create a **Web App** (Linux or Windows) and set runtime to **Node**.
- Deploy your code (GitHub Actions, Azure CLI, or ZIP deploy) so that the App Service runs `node server.js` (or `npm run server`).
- Set the **start command** if needed (e.g. `node server.js` or `npm start`).

### Environment variables (Application settings)

In the App Service → **Configuration** → **Application settings**, add:

**Runtime (recommended)**

| Name | Value | Slot setting |
|------|--------|--------------|
| `NODE_ENV` | `production` | ✓ |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~20` or `22` (match `package.json` `engines`) | Optional; set in **Configuration** → **General settings** if the stack picker does not match |

**Database – use one of these (same names as local `.env`; `.env` is not deployed)**

**Option A – Connection string**

| Name | Value | Slot setting |
|------|--------|--------------|
| `AZURE_SQL_CONNECTION_STRING` | `Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=YOUR_DB;User ID=YOUR_USER;Password=YOUR_PASSWORD;Encrypt=true;TrustServerCertificate=false` | ✓ |

Or **`SQLSERVER_CONNECTION_STRING`** with the same value (see `src/db.js`).

**Option B – Separate variables (preferred when passwords have special characters)**

The app accepts either **`AZURE_SQL_*`** or **`SQLSERVER_*`** (same semantics).

| Name | Value | Slot setting |
|------|--------|--------------|
| `AZURE_SQL_SERVER` or `SQLSERVER_HOST` | `yourserver.database.windows.net` | ✓ |
| `AZURE_SQL_DATABASE` or `SQLSERVER_DATABASE` | Your database name | ✓ |
| `AZURE_SQL_USER` or `SQLSERVER_USER` | SQL login user | ✓ |
| `AZURE_SQL_PASSWORD` or `SQLSERVER_PASSWORD` | SQL login password | ✓ (mark as secret) |
| `AZURE_SQL_PORT` or `SQLSERVER_PORT` | `1433` (optional) | ✓ |

**Required for auth and same-origin SPA**

| Name | Value | Slot setting |
|------|--------|--------------|
| `SESSION_SECRET` | A long random string (e.g. 32+ chars) | ✓ |
| `FRONTEND_ORIGIN` | Your site URL, e.g. `https://your-app.azurewebsites.net` or `https://your-domain.com` (no trailing slash) | ✓ |
| `FRONTEND_ORIGINS` | Optional. Comma-separated **extra** origins if users reach the app at more than one URL. Must match the browser address bar (scheme + host, no path; no trailing slash). Spaces after commas are trimmed. | |
| `SESSION_COOKIE_SAMESITE` | Optional. Default `lax`. Use `none` only if the **browser’s page URL host** is different from the **API host** (cross-origin SPA + API); requires HTTPS. | |
| `LOG_CORS_REJECTIONS` | Optional. Set to `1` temporarily to log blocked `Origin` values to App Service logs (see troubleshooting below). | |

The API sets **trust proxy** for Azure’s load balancer so `secure` session cookies work over HTTPS.

**Example — `www`, apex, and Azure hostname (Wise App):** users may open any of these; list every **origin** (scheme + host, no path):

| Setting | Value (copy as one line per row; no spaces after commas in `FRONTEND_ORIGINS`) |
|--------|----------------------------------------------------------------------------------|
| `FRONTEND_ORIGIN` | `https://www.wiseapp.co.za` (pick one canonical URL for email links; often `www` or apex) |
| `FRONTEND_ORIGINS` | `https://wiseapp.co.za,https://tihlo-ajezeehje0ebeabf.southafricanorth-01.azurewebsites.net` |

That covers `www.wiseapp.co.za`, `wiseapp.co.za`, and the regional Azure default host (`southafricanorth-01.azurewebsites.net`). If your App Service name or region changes, update the third URL to match **Configuration → Overview → Default domain**.

**Do not** add spaces after commas in `FRONTEND_ORIGINS`. Use **https** for all three if the site is served over HTTPS.

If the UI shows “Cannot reach the API” in production, the browser is blocking the request or the API URL is wrong. Check in order:

1. **Same App Service for UI + API** – Open **https://your-domain/** and confirm `https://your-domain/api/health` returns `{"ok":true}` in the browser. If that 404s, the deploy is missing `client/dist` or the start command is wrong.
2. **CORS** – `FRONTEND_ORIGIN` and `FRONTEND_ORIGINS` must list **every** URL users type in the address bar (`https://www…`, `https://…` apex, and `https://….azurewebsites.net` if used). No spaces after commas. Restart the Web App after saving.
3. **Debug CORS** – Add Application setting `LOG_CORS_REJECTIONS` = `1`, restart, reproduce the issue, then read **Log stream** / **Logs**. You will see `[cors] blocked Origin: …` with the exact `Origin` the browser sent; add that string (scheme + host, no path) to `FRONTEND_ORIGIN` or `FRONTEND_ORIGINS`, then remove `LOG_CORS_REJECTIONS`.
4. **SPA on a different host than the API** – Rebuild the client with `VITE_API_BASE=https://your-api-host/api` and set `SESSION_COOKIE_SAMESITE` = `none` (session cookies on cross-site requests require `SameSite=None` and HTTPS).

If it works locally but not online, the online build is almost always **wrong API base URL**, **missing env on App Service**, or **CORS** (wrong or missing origin).

**Optional – email:**  
If you use the app’s email features, add `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM_NAME`, and optionally `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE` as in your `.env.example`.

Save **Configuration** so the App Service picks up the new settings. The backend will then connect to Azure SQL using `src/db.js`.

**Startup command** (Linux): under **Configuration** → **General settings**, use **`npm start`** (runs `node server.js` from `package.json`) or `node server.js`.

### GitHub Actions deploy (this repo)

The workflow **`.github/workflows/main_tihlo.yml`** builds on push to `main` and deploys with `azure/webapps-deploy`. It does **not** inject database passwords; you must still set Application settings in the Portal (or use Azure Key Vault references). After changing settings, restart the Web App.

---

## 4. Frontend on Azure

### Option A – Same App Service (API + static files)

- Build the client: `cd client && npm run build`.
- Serve the contents of `client/dist` from your Express app (e.g. `express.static('client/dist')` and a catch‑all for SPA routing).
- Deploy the repo including `client/dist` (or run the build in your deployment pipeline).  
Then one URL serves both API and frontend; no `VITE_API_BASE` needed if the app calls the same origin (the production client defaults to same-origin `/api`). The server sends **no-cache** headers for `index.html` so browsers pick up new JS after deploy—if users still see old behavior, have them hard-refresh or clear site data once.

### Option B – Frontend on Azure Static Web Apps

- Deploy the Vite app to **Azure Static Web Apps** (build: `cd client && npm run build`, output: `client/dist`).
- In Static Web Apps **Configuration** (or in the build), set:
  - `VITE_API_BASE` = your backend URL, e.g. `https://your-app.azurewebsites.net/api`
- So the frontend is built with the correct API URL and talks to your App Service backend.

---

## 5. Quick checklist

- [ ] Azure SQL server and database exist; SQL user has access.
- [ ] SQL server firewall: **Allow Azure services and resources to access this server** (and your IP for local dev).
- [ ] App Service **Configuration** → Application settings: `AZURE_SQL_*` or `SQLSERVER_*` or a connection string; `NODE_ENV=production`; `SESSION_SECRET`; `FRONTEND_ORIGIN` = primary HTTPS site URL; `FRONTEND_ORIGINS` = any other hostnames users use (apex + `www` + `.azurewebsites.net` if applicable), comma-separated.
- [ ] Backend **Startup Command** `npm start` or `node server.js` (Linux).
- [ ] If frontend is on Static Web Apps, `VITE_API_BASE` points to your App Service API URL.

---

## 6. Local development

Keep using `.env` in the project root with the same variable names (`AZURE_SQL_CONNECTION_STRING` or the individual `AZURE_SQL_*` vars). Add your IP to the Azure SQL firewall so your machine can connect. Do not commit `.env` (it’s in `.gitignore`).
