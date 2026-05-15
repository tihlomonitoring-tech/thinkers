-- Grant Atomic fleet verification tab to users who already have Fleet verification (AI).
-- Run once in SSMS or: node scripts/run-sql-file.js scripts/grant-atomic-fleet-verification-tab.sql

INSERT INTO command_centre_grants (user_id, tab_id, granted_by_user_id)
SELECT g.user_id, N'atomic_fleet_verification', g.granted_by_user_id
FROM command_centre_grants g
WHERE g.tab_id = N'fleet_verification'
  AND NOT EXISTS (
    SELECT 1 FROM command_centre_grants x
    WHERE x.user_id = g.user_id AND x.tab_id = N'atomic_fleet_verification'
  );
