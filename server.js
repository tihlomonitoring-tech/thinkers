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
import commandCentreRoutes from './src/routes/commandCentre.js';
import reportBreakdownRoutes from './src/routes/reportBreakdown.js';
import testEmailRoutes from './src/routes/testEmail.js';
import tasksRoutes, { runOverdueTaskNotifications } from './src/routes/tasks.js';
import profileManagementRoutes from './src/routes/profileManagement.js';
import progressReportsRoutes from './src/routes/progressReports.js';
import actionPlansRoutes from './src/routes/actionPlans.js';
import monthlyPerformanceReportsRoutes from './src/routes/monthlyPerformanceReports.js';
import recruitmentRoutes from './src/routes/recruitment.js';
import accountingRoutes from './src/routes/accounting.js';
import { isEmailConfigured } from './src/lib/emailService.js';
import { runAutoReinstateSuspensions } from './src/lib/autoReinstateSuspensions.js';
import { runPilotListDistributions } from './src/lib/pilotListDistributionRunner.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '50mb' })); // allow large payloads e.g. progress report PDF send-email
app.use(
  session({
    name: 'thinkers.sid',
    secret: process.env.SESSION_SECRET || 'thinkers-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contractor', contractorRoutes);
app.use('/api/command-centre', commandCentreRoutes);
app.use('/api/report-breakdown', reportBreakdownRoutes);
app.use('/api/test-email', testEmailRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/profile-management', profileManagementRoutes);
app.use('/api/progress-reports', progressReportsRoutes);
app.use('/api/action-plans', actionPlansRoutes);
app.use('/api/monthly-performance-reports', monthlyPerformanceReportsRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/accounting', accountingRoutes);

// Serve frontend (Vite build) when both run on same host (e.g. Render, Railway)
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
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

const server = app.listen(PORT, () => {
  console.log(`Thinkers API running at http://localhost:${PORT}`);
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
  }, AUTO_REINSTATE_MS);
  // Pilot list distribution (Access Management schedules) — check every minute
  const PILOT_DIST_MS = 60 * 1000;
  setInterval(() => {
    runPilotListDistributions().catch((e) => console.error('[pilot-distribution]', e?.message || e));
  }, PILOT_DIST_MS);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the other process or use a different PORT.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exitCode = 1;
});
