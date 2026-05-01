-- Extend dbo.leave_types for SA sector labels, descriptions, and sort_order.
-- Idempotent. Dynamic SQL avoids single-batch compile errors on new column names.
-- Run: node scripts/run-sa-leave-types-extend.js

IF OBJECT_ID(N'dbo.leave_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.leave_types', N'sector') IS NULL
  EXEC(N'ALTER TABLE dbo.leave_types ADD sector NVARCHAR(20) NULL');
GO

IF OBJECT_ID(N'dbo.leave_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.leave_types', N'description') IS NULL
  EXEC(N'ALTER TABLE dbo.leave_types ADD description NVARCHAR(500) NULL');
GO

IF OBJECT_ID(N'dbo.leave_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.leave_types', N'sort_order') IS NULL
  EXEC(N'ALTER TABLE dbo.leave_types ADD sort_order INT NOT NULL CONSTRAINT DF_leave_types_sort_order_sa DEFAULT (100)');
GO

IF OBJECT_ID(N'dbo.leave_types', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
     FROM sys.check_constraints cc
     WHERE cc.name = N'CK_leave_types_sector'
       AND cc.parent_object_id = OBJECT_ID(N'dbo.leave_types')
   )
  EXEC(N'ALTER TABLE dbo.leave_types ADD CONSTRAINT CK_leave_types_sector CHECK (sector IS NULL OR sector IN (N''public'', N''private'', N''both''))');
GO
