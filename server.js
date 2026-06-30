import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import authRoutes from './src/routes/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import tenantRoutes from './src/routes/tenants.js';
import userRoutes from './src/routes/users.js';
import contractorRoutes from './src/routes/contractor.js';
import fleetMaintenanceRoutes from './src/routes/fleetMaintenance.js';
import workshopRoutes from './src/routes/workshop.js';
import truckInspectionRoutes from './src/routes/truckInspection.js';
import commandCentreRoutes, { runCommandCentreReminderNotifications } from './src/routes/commandCentre.js';
import reportGenerationRoutes from './src/routes/reportGeneration.js';
import officeAdminRoutes from './src/routes/officeAdmin.js';
import reportBreakdownRoutes from './src/routes/reportBreakdown.js';
import reportExternalInspectionRoutes from './src/routes/reportExternalInspection.js';
import testEmailRoutes from './src/routes/testEmail.js';
import tasksRoutes, { runOverdueTaskNotifications } from './src/routes/tasks.js';
import profileManagementRoutes from './src/routes/profileManagement.js';
import shiftClockRoutes, { runShiftClockAlerts } from './src/routes/shiftClock.js';
import shiftScoreRoutes from './src/routes/shiftScore.js';
import progressReportsRoutes from './src/routes/progressReports.js';
import actionPlansRoutes from './src/routes/actionPlans.js';
import monthlyPerformanceReportsRoutes from './src/routes/monthlyPerformanceReports.js';
import recruitmentRoutes from './src/routes/recruitment.js';
import accountingRoutes from './src/routes/accounting.js';
import fuelSupplyRoutes from './src/routes/fuelSupply.js';
import fuelDataRoutes from './src/routes/fuelData.js';
import fuelVehicleExpensesRoutes from './src/routes/fuelVehicleExpenses.js';
import fuelCustomerPortalRoutes from './src/routes/fuelCustomerPortal.js';
import teamGoalsRoutes from './src/routes/teamGoals.js';
import performanceEvaluationsRoutes from './src/routes/performanceEvaluations.js';
import userCareerRoutes from './src/routes/userCareer.js';
import caseManagementRoutes from './src/routes/caseManagement.js';
import aiRoutes from './src/routes/ai.js';
import companyLibraryRoutes, { runCompanyLibraryExpiryReminders } from './src/routes/companyLibrary.js';
import quickSignRoutes from './src/routes/quickSign.js';
import operatorManagementRoutes from './src/routes/operatorManagement.js';
import expenseManagementRoutes from './src/routes/expenseManagement.js';
import logisticsFinanceRoutes from './src/routes/logisticsFinance.js';
import trackingRoutes from './src/routes/tracking.js';
import companyPoliciesRoutes from './src/routes/companyPolicies.js';
import lettersRoutes from './src/routes/letters.js';
import tabAccessRoutes from './src/routes/tabAccess.js';
import vehicleComplianceRoutes from './src/routes/vehicleCompliance.js';
import vehicleTrackerComplianceRoutes from './src/routes/vehicleTrackerCompliance.js';
import claimsRoutes from './src/routes/claims.js';
import orgStructureRoutes from './src/routes/orgStructure.js';
import truckOnboardingRoutes from './src/routes/truckOnboarding.js';
import { isEmailConfigured } from './src/lib/emailService.js';
import { isDbEnvConfigured, query } from './src/db.js';
import { runAutoReinstateSuspensions } from './src/lib/autoReinstateSuspensions.js';
import { runTrackerComplianceGraceExpiry, runPassedCheckExpiry } from './src/lib/vehicleTrackerCompliance.js';
import { runPilotListDistributions } from './src/lib/pilotListDistributionRunner.js';
import { runFuelDataAutoShareDistributions } from './src/lib/fuelDataAutoShareRunner.js';
import { runTrackingProviderPoll, pollIntervalMs, isTrackingPollEnabled } from './src/lib/trackingProviderPoll.js';

const app = express();
// Azure App Service / reverse proxies: correct req.secure, req.ip, and secure session cookies
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3001;

function normalizeOrigin(o) {
  if (!o || typeof o !== 'string') return '';
  return o.trim().replace(/\/$/, '');
}

/** Normalize scheme + host + port for CORS (host lowercased; avoids www vs WWW mismatches). */
function canonicalOrigin(o) {
  const n = normalizeOrigin(o);
  if (!n) return '';
  try {
    const u = new URL(n);
    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${host}${port}`;
  } catch {
    return n;
  }
}

// CORS: public origins must match FRONTEND_ORIGIN / FRONTEND_ORIGINS (canonical host, etc.).
// Loopback browser origins (localhost / 127.0.0.1 / ::1, any port) are always allowed so local dev works
// even when root .env sets NODE_ENV=production.
// Split FRONTEND_ORIGIN on commas too (some portals paste multiple URLs into one field).
const extraFromEnv = [
  ...(process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',') : []),
  ...(process.env.FRONTEND_ORIGINS ? process.env.FRONTEND_ORIGINS.split(',') : []),
].map((s) => s.trim());
const corsOriginSet = new Set(
  ['http://localhost:5173', 'http://127.0.0.1:5173', ...extraFromEnv].map(canonicalOrigin).filter(Boolean)
);

function isLoopbackOrigin(o) {
  try {
    const u = new URL(o);
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const n = canonicalOrigin(origin);
      if (corsOriginSet.has(n)) return callback(null, true);
      // Always allow browser loopback origins. Real users on https://your-domain never send these;
      // this avoids breaking local dev when root .env has NODE_ENV=production (strict prod CORS otherwise blocks non-5173 Vite ports).
      if (isLoopbackOrigin(origin)) return callback(null, true);
      if (process.env.LOG_CORS_REJECTIONS === '1' || process.env.LOG_CORS_REJECTIONS === 'true') {
        console.warn('[cors] blocked Origin:', origin, '→ canonical:', n, '| allowed count:', corsOriginSet.size);
      }
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' })); // allow large payloads e.g. progress report PDF send-email

// Same-site default is Lax. If the SPA is on a different host than the API (cross-site), set
// SESSION_COOKIE_SAMESITE=none in App Service so the browser sends the session cookie on credentialed fetches (requires HTTPS / secure cookie).
const rawSameSite = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();
const sessionSameSite = rawSameSite === 'none' || rawSameSite === 'lax' || rawSameSite === 'strict' ? rawSameSite : 'lax';
const sessionSecure = process.env.NODE_ENV === 'production';
if (sessionSameSite === 'none' && !sessionSecure) {
  console.warn('[session] SESSION_COOKIE_SAMESITE=none requires HTTPS; using secure=false in non-production may break cookies.');
}

app.use(
  session({
    name: 'thinkers.sid',
    secret: process.env.SESSION_SECRET || 'thinkers-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: sessionSecure,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: sessionSameSite,
    },
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true, build: 'fuel-guid-normalize-2026-06-30' }));
app.get('/api/command-centre/logistics-flow/shift-report-link/ping', (_req, res) => {
  res.json({ ok: true, feature: 'logistics-shift-report-link', version: 1 });
});

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contractor', contractorRoutes);
app.use('/api/fleet-maintenance', fleetMaintenanceRoutes);
app.use('/api/workshop', workshopRoutes);
app.use('/api/truck-inspection', truckInspectionRoutes);
app.use('/api/command-centre', commandCentreRoutes);
app.use('/api/report-generation', reportGenerationRoutes);
app.use('/api/office-admin', officeAdminRoutes);
app.use('/api/report-breakdown', reportBreakdownRoutes);
app.use('/api/report-external-inspection', reportExternalInspectionRoutes);
app.use('/api/test-email', testEmailRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/profile-management', profileManagementRoutes);
app.use('/api/shift-clock', shiftClockRoutes);
app.use('/api/shift-score', shiftScoreRoutes);
app.use('/api/progress-reports', progressReportsRoutes);
app.use('/api/action-plans', actionPlansRoutes);
app.use('/api/monthly-performance-reports', monthlyPerformanceReportsRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/expense-management', expenseManagementRoutes);
app.use('/api/logistics-finance', logisticsFinanceRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/tab-access', tabAccessRoutes);
app.use('/api/vehicle-compliance', vehicleComplianceRoutes);
app.use('/api/vehicle-tracker-compliance', vehicleTrackerComplianceRoutes);
app.use('/api/claims', claimsRoutes);
app.use('/api/org-structure', orgStructureRoutes);
app.use('/api/truck-onboarding', truckOnboardingRoutes);
app.use('/api/fuel-supply', fuelSupplyRoutes);
app.use('/api/fuel-data', fuelDataRoutes);
app.use('/api/fuel-data/vehicle-expenses', fuelVehicleExpensesRoutes);
app.use('/api/fuel-customer-portal', fuelCustomerPortalRoutes);
app.use('/api/team-goals', teamGoalsRoutes);
app.use('/api/performance-evaluations', performanceEvaluationsRoutes);
app.use('/api/user-career', userCareerRoutes);
app.use('/api/case-management', caseManagementRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/company-library', companyLibraryRoutes);
app.use('/api/company-policies', companyPoliciesRoutes);
app.use('/api/letters', lettersRoutes);
app.use('/api/quick-sign', quickSignRoutes);
app.use('/api/operator-management', operatorManagementRoutes);

// Unmatched /api/* — Express default 404 is often non-JSON, so the client showed a bare "Not Found".
app.use('/api', (req, res) => {
  const pathLower = `${req.path || ''} ${req.originalUrl || ''}`.toLowerCase();
  const truckAnalysisHint =
    pathLower.includes('truck-analysis') &&
    'Command Centre truck analysis requires this API version (routes under /api/command-centre/truck-analysis) and the truck_analysis_handovers table. On the database host run: npm run db:truck-analysis-handovers — then redeploy the Node server so it includes src/routes/commandCentre.js with those routes.';
  const logisticsFinanceHint =
    pathLower.includes('logistics-finance') &&
    'Logistics finance requires this API version (routes under /api/logistics-finance). Run: npm run db:logistics-finance && npm run db:logistics-finance-page-role — then restart the Node server (npm run server). Ping: GET /api/logistics-finance/ping should return 200.';
  const companyPoliciesHint =
    pathLower.includes('company-policies') &&
    'Company policies requires this API version (routes under /api/company-policies). Run: npm run db:company-policies && npm run db:user-page-roles-policy-development — then restart the Node server (npm run server). Ping: GET /api/company-policies/ping should return 200.';
  const creditsHint =
    (pathLower.includes('team-leader/credit') ||
      pathLower.includes('team-leader/issue-') ||
      pathLower.includes('member-credit-applications') ||
      pathLower.includes('team-point-pools')) &&
    'Team leader / team credit routes need a restarted API (npm run server). Paths: /api/team-goals/team-leader/* and /api/profile-management/team-point-pools/*. Run npm run db:employee-grace-credits && npm run db:team-credit-pools if tables are missing.';
  const trackingLogisticsHint =
    pathLower.includes('logistics-activity') &&
    'Logistics Activity routes live under /api/tracking/logistics-activity/* (not /api/logistics-activity). Restart the API after pulling: npm run server — then run npm run db:tracking-logistics-activity if the board is empty.';
  const logisticsShiftReportHint =
    (pathLower.includes('shift-report-drafts') ||
      pathLower.includes('compose-shift-report-entry') ||
      pathLower.includes('link-shift-report')) &&
    'Logistics flow → shift report linking requires a restarted API with the latest code. Restart: npm run server (local) or redeploy the Node app (production). Ping: GET /api/command-centre/logistics-flow/shift-report-link/ping should return {"ok":true}.';
  const vehicleTrackerComplianceHint =
    pathLower.includes('vehicle-tracker-compliance') &&
    'Vehicle Tracker Compliance requires a restarted API (routes under /api/vehicle-tracker-compliance). Run: npm run db:vehicle-tracker-compliance && npm run server — then reload Access Management.';
  const workScheduleShiftHint =
    (pathLower.includes('shift-settings') ||
      pathLower.includes('schedules/fixed') ||
      pathLower.includes('work-schedules/ping')) &&
    'Work schedule shift times and fixed-hour bulk routes require the latest API. Run: npm run db:work-schedule-shift-settings — then restart the Node server (npm run server) or redeploy. Ping: GET /api/profile-management/work-schedules/ping should return {"ok":true}.';
  const genericHint =
    'No route matched. Check the URL (including /api prefix and path), that the server process is the latest deployment, and that reverse proxies forward /api to this app.';
  res.status(404).json({
    error: 'API route not found',
    path: req.originalUrl,
    method: req.method,
    hint: truckAnalysisHint || logisticsFinanceHint || companyPoliciesHint || creditsHint || trackingLogisticsHint || logisticsShiftReportHint || vehicleTrackerComplianceHint || workScheduleShiftHint || genericHint,
  });
});

// Serve frontend (Vite build) when both run on same host (e.g. Render, Railway, Azure)
const clientDist = path.join(__dirname, 'client', 'dist');
const noCacheHtml = (res, filePath) => {
  if (filePath.endsWith('index.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
};
app.use(
  express.static(clientDist, {
    setHeaders: (res, pathName) => noCacheHtml(res, pathName),
  })
);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message || err);
  if (err.stack) console.error(err.stack);
  const message = err.message || 'Internal server error';
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: message,
    ...(isDev && err.stack && { detail: err.stack }),
  });
});

setInterval(() => {
  runShiftClockAlerts().catch(() => {});
}, 5 * 60 * 1000);

setInterval(() => {
  runCompanyLibraryExpiryReminders().catch(() => {});
}, 60 * 60 * 1000);

const server = app.listen(PORT, () => {
  console.log(`Thinkers API running at http://localhost:${PORT}`);
  runShiftClockAlerts().catch(() => {});
  runCompanyLibraryExpiryReminders().catch(() => {});
  if (!isDbEnvConfigured()) {
    console.warn(
      'Database: no SQLSERVER_* / AZURE_SQL_* / connection string in environment — API routes that use the DB will fail. ' +
        'Set the same variables in Azure App Service → Configuration, ECS task definition, etc. (.env is not deployed).'
    );
  }
  const emailOn = isEmailConfigured();
  console.log(
    'Email:',
    emailOn
      ? 'yes (SMTP via EMAIL_USER / EMAIL_PASS @ ' + (process.env.EMAIL_HOST || 'smtp.gmail.com').trim() + ')'
      : 'no — set EMAIL_USER & EMAIL_PASS in .env (set EMAIL_ENABLED=false to force off)'
  );
  if (emailOn && !(process.env.FRONTEND_ORIGIN || process.env.APP_URL || '').trim()) {
    console.warn('Email: set FRONTEND_ORIGIN (or APP_URL) so password-reset links are not localhost-only.');
  }
  // Run overdue task emails every 24 hours
  const OVERDUE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runOverdueTaskNotifications().catch((e) => console.error('[tasks] Overdue notify error:', e?.message || e));
  }, OVERDUE_INTERVAL_MS);
  // Auto-reinstate suspensions when duration has ended (every 15 min)
  const AUTO_REINSTATE_MS = 15 * 60 * 1000;
  setInterval(() => {
    runAutoReinstateSuspensions().catch((e) => console.error('[autoReinstate]', e?.message || e));
    runTrackerComplianceGraceExpiry(query).catch((e) => console.error('[trackerComplianceGrace]', e?.message || e));
    runPassedCheckExpiry(query).catch((e) => console.error('[trackerComplianceExpiry]', e?.message || e));
  }, AUTO_REINSTATE_MS);
  // Pilot list distribution (Access Management schedules) — check every minute
  const PILOT_DIST_MS = 60 * 1000;
  setInterval(() => {
    runPilotListDistributions().catch((e) => console.error('[pilot-distribution]', e?.message || e));
  }, PILOT_DIST_MS);
  // Command Centre notes reminders — check every minute
  const CC_REMINDER_MS = 60 * 1000;
  setInterval(() => {
    runCommandCentreReminderNotifications().catch((e) => console.error('[cc-reminder]', e?.message || e));
  }, CC_REMINDER_MS);
  // Fuel Data — Auto Share schedules — check every minute
  const FUEL_AUTO_SHARE_MS = 60 * 1000;
  setInterval(() => {
    runFuelDataAutoShareDistributions().catch((e) => console.error('[fuel-auto-share]', e?.message || e));
  }, FUEL_AUTO_SHARE_MS);

  // Telematics — poll Cartrack / FleetCam / linked units (default every 60s)
  if (isTrackingPollEnabled()) {
    const TRACKING_POLL_MS = pollIntervalMs();
    console.log(`Tracking poll: enabled every ${TRACKING_POLL_MS / 1000}s (TRACKING_POLL_ENABLED / TRACKING_POLL_INTERVAL_MS)`);
    runTrackingProviderPoll().catch((e) => console.error('[trackingPoll]', e?.message || e));
    setInterval(() => {
      runTrackingProviderPoll().catch((e) => console.error('[trackingPoll]', e?.message || e));
    }, TRACKING_POLL_MS);
  } else {
    console.log('Tracking poll: disabled (TRACKING_POLL_ENABLED=false)');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the other process or use a different PORT.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exitCode = 1;
});
