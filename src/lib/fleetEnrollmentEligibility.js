/** Trucks/drivers eligible for route enrollment and list/tracking distribution. */

export const TRUCK_APPROVED_SQL = `t.facility_access = 1
  AND ISNULL(t.contractor_approval_status, N'approved_contractor') = N'approved_contractor'
  AND NOT EXISTS (
    SELECT 1 FROM contractor_suspensions s
    WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50))
      AND s.[status] IN (N'suspended', N'under_appeal')
  )`;

export const DRIVER_APPROVED_SQL = `d.facility_access = 1
  AND ISNULL(d.contractor_approval_status, N'approved_contractor') = N'approved_contractor'
  AND NOT EXISTS (
    SELECT 1 FROM contractor_suspensions s
    WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50))
      AND s.[status] IN (N'suspended', N'under_appeal')
  )`;

export const TRUCK_LIST_ELIGIBLE_SQL = ` AND t.facility_access = 1
  AND ISNULL(t.contractor_approval_status, N'approved_contractor') = N'approved_contractor'
  AND NOT EXISTS (
    SELECT 1 FROM contractor_suspensions s
    WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50))
      AND s.[status] IN (N'suspended', N'under_appeal')
  )`;

export const DRIVER_LIST_ELIGIBLE_SQL = ` AND d.facility_access = 1
  AND ISNULL(d.contractor_approval_status, N'approved_contractor') = N'approved_contractor'
  AND NOT EXISTS (
    SELECT 1 FROM contractor_suspensions s
    WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50))
      AND s.[status] IN (N'suspended', N'under_appeal')
  )`;
