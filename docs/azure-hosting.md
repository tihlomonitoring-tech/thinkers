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

**Database – use one of these:**

**Option A – Connection string (recommended)**

| Name | Value | Slot setting |
|------|--------|--------------|
| `AZURE_SQL_CONNECTION_STRING` | `Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=YOUR_DB;User ID=YOUR_USER;Password=YOUR_PASSWORD;Encrypt=true;TrustServerCertificate=false` | ✓ |

**Option B – Separate variables**

| Name | Value | Slot setting |
|------|--------|--------------|
| `AZURE_SQL_SERVER` | `yourserver.database.windows.net` | ✓ |
| `AZURE_SQL_DATABASE` | Your database name | ✓ |
| `AZURE_SQL_USER` | SQL login user | ✓ |
| `AZURE_SQL_PASSWORD` | SQL login password | ✓ (mark as secret) |
| `AZURE_SQL_PORT` | `1433` (optional) | ✓ |

**Required for auth:**

| Name | Value | Slot setting |
|------|--------|--------------|
| `SESSION_SECRET` | A long random string (e.g. 32+ chars) | ✓ |

**Optional – email:**  
If you use the app’s email features, add `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM_NAME`, and optionally `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE` as in your `.env.example`.

Save **Configuration** so the App Service picks up the new settings. The backend will then connect to Azure SQL using `src/db.js`.

---

## 4. Frontend on Azure

### Option A – Same App Service (API + static files)

- Build the client: `cd client && npm run build`.
- Serve the contents of `client/dist` from your Express app (e.g. `express.static('client/dist')` and a catch‑all for SPA routing).
- Deploy the repo including `client/dist` (or run the build in your deployment pipeline).  
Then one URL serves both API and frontend; no `VITE_API_BASE` needed if the app calls the same origin.

### Option B – Frontend on Azure Static Web Apps

- Deploy the Vite app to **Azure Static Web Apps** (build: `cd client && npm run build`, output: `client/dist`).
- In Static Web Apps **Configuration** (or in the build), set:
  - `VITE_API_BASE` = your backend URL, e.g. `https://your-app.azurewebsites.net/api`
- So the frontend is built with the correct API URL and talks to your App Service backend.

---

## 5. Quick checklist

- [ ] Azure SQL server and database exist; SQL user has access.
- [ ] SQL server firewall: **Allow Azure services and resources to access this server** (and your IP for local dev).
- [ ] App Service **Configuration** → Application settings: either `AZURE_SQL_CONNECTION_STRING` or `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD`.
- [ ] `SESSION_SECRET` set on App Service.
- [ ] Backend start command runs `node server.js` (or equivalent).
- [ ] If frontend is on Static Web Apps, `VITE_API_BASE` points to your App Service API URL.

---

## 6. Local development

Keep using `.env` in the project root with the same variable names (`AZURE_SQL_CONNECTION_STRING` or the individual `AZURE_SQL_*` vars). Add your IP to the Azure SQL firewall so your machine can connect. Do not commit `.env` (it’s in `.gitignore`).
