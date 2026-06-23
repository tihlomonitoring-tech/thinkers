-- Camera portal login on contractor fleet trucks.
-- Run: npm run db:contractor-truck-camera

IF COL_LENGTH('contractor_trucks', 'camera_username') IS NULL
  ALTER TABLE contractor_trucks ADD camera_username NVARCHAR(255) NULL;
GO

IF COL_LENGTH('contractor_trucks', 'camera_password') IS NULL
  ALTER TABLE contractor_trucks ADD camera_password NVARCHAR(255) NULL;
GO

IF COL_LENGTH('contractor_trucks', 'camera_provider') IS NULL
  ALTER TABLE contractor_trucks ADD camera_provider NVARCHAR(100) NULL;
GO
