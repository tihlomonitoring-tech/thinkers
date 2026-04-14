#!/usr/bin/env node
/**
 * Run every schema migration in dependency-safe order (idempotent where scripts allow).
 * Does not run seeds (npm run seed) or mock data (db:tracking-mock, db:seed-mock-breakdown).
 *
 * Usage: npm run db:migrate-all
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCRIPTS = [
  'db:schema',
  'db:user-tenants',
  'db:users-id-number',
  'db:users-login-lockout',
  'db:sign-up-requests',
  'db:password-reset',
  'db:user-page-roles',
  'db:user-page-roles-transport-operations',
  'db:user-page-roles-recruitment',
  'db:user-page-roles-accounting-management',
  'db:user-page-roles-tracking-integration',
  'db:contractor',
  'db:contractor-expand',
  'db:contractor-incidents-expand',
  'db:contractor-incidents-resolve',
  'db:contractor-incidents-location-route',
  'db:contractor-ensure',
  'db:contractor-unique',
  'db:command-centre',
  'db:truck-analysis-handovers',
  'db:command-centre-shift-reports',
  'db:command-centre-investigation-reports',
  'db:command-centre-library-documents',
  'db:command-centre-compliance-inspections',
  'db:compliance-response-attachments',
  'db:compliance-inspector-reply',
  'db:suspension-duration',
  'db:fleet-applications',
  'db:route-enrollment',
  'db:access-management',
  'db:access-management-rectors',
  'db:access-management-rector-user',
  'db:distribution-history',
  'db:pilot-distribution',
  'db:access-distribution-fleet-bot',
  'db:access-distribution-pilot',
  'db:cc-fleet-republish-bot-log',
  'db:accounting-company-settings',
  'db:accounting-quotations',
  'db:accounting-customers-invoices',
  'db:accounting-discount-tax-suppliers-po-statements',
  'db:accounting-per-line-discount-tax-items-library',
  'db:accounting-invoice-paid-recurring',
  'db:accounting-invoice-show-issue-date-pdf',
  'db:accounting-statement-lines',
  'db:accounting-documentation',
  'db:accounting-documentation-versions',
  'db:transport-operations',
  'db:transport-operations-expand',
  'db:transport-operations-approvals',
  'db:transport-operations-shift-sections',
  'db:transport-operations-presentations',
  'db:tasks',
  'db:tasks-library',
  'db:tracking-integration',
  'db:tracking-expand-contractor-truck',
  'db:fleet-app-comments',
  'db:contractor-info-library',
  'db:contractor-library-entity-links',
  'db:contractors-multi',
  'db:backfill-contractor-id',
  'db:contractor-driver-linked-truck',
  'db:contractor-messages-platform',
  'db:profile-management',
  'db:profile-missing-tables',
  'db:shift-clock',
  'db:login-location',
  'db:progress-reports',
  'db:action-plans',
  'db:monthly-performance-reports',
  'db:fuel-supply',
  'db:fuel-supply-expand-v2',
  'db:fuel-customer-requests',
  'db:user-page-roles-fuel-customer-orders',
  'db:recruitment',
  'db:recruitment-expand',
  'db:tracking-setup',
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const name of SCRIPTS) {
  console.log(`\n========== npm run ${name} ==========\n`);
  const r = spawnSync(npmCmd, ['run', name], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\nMigration failed: ${name} (exit ${r.status ?? 1})\n`);
    process.exit(r.status ?? 1);
  }
}

console.log('\nAll migrations completed.\n');
