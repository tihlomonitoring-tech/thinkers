/** Shared SQL fragments for contractor fleet/driver enrollment APIs. */

export const TRUCK_ENROLLMENT_SELECT = `
  t.trailer_1_reg_no, t.trailer_2_reg_no,
  ISNULL(NULLIF(LTRIM(RTRIM(co.name)), N''), NULLIF(LTRIM(RTRIM(t.main_contractor)), N'')) AS main_contractor_display,
  ISNULL(NULLIF(LTRIM(RTRIM(sc.company_name)), N''), NULLIF(LTRIM(RTRIM(t.sub_contractor)), N'')) AS sub_contractor_display,
  facility_app.reviewed_at AS facility_approved_at,
  facility_app.facility_approved_by_name`;

export const TRUCK_ENROLLMENT_JOINS = `
  LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = t.tenant_id
  LEFT JOIN contractor_subcontractors sc ON sc.id = t.subcontractor_id AND sc.tenant_id = t.tenant_id
  OUTER APPLY (
    SELECT TOP 1
      COALESCE(a.reviewed_at, hist.performed_at) AS reviewed_at,
      COALESCE(u.full_name, hist_u.full_name) AS facility_approved_by_name
    FROM cc_fleet_applications a
    LEFT JOIN users u ON u.id = a.reviewed_by_user_id
    OUTER APPLY (
      SELECT TOP 1 h.performed_at, h.performed_by_user_id
      FROM cc_fleet_application_history h
      WHERE h.fleet_application_id = a.id AND h.[action] = N'approved'
      ORDER BY h.performed_at DESC
    ) hist
    LEFT JOIN users hist_u ON hist_u.id = hist.performed_by_user_id
    WHERE a.tenant_id = t.tenant_id AND a.entity_type = N'truck' AND a.entity_id = t.id
      AND COALESCE(a.reviewed_at, hist.performed_at) IS NOT NULL
    ORDER BY COALESCE(a.reviewed_at, hist.performed_at) DESC
  ) facility_app`;

export const DRIVER_ENROLLMENT_SELECT = `
  ISNULL(NULLIF(LTRIM(RTRIM(co.name)), N''), NULLIF(LTRIM(RTRIM(t.main_contractor)), N'')) AS main_contractor_display,
  ISNULL(NULLIF(LTRIM(RTRIM(sc.company_name)), N''), NULLIF(LTRIM(RTRIM(t.sub_contractor)), N'')) AS sub_contractor_display,
  facility_app.reviewed_at AS facility_approved_at,
  facility_app.facility_approved_by_name`;

export const DRIVER_ENROLLMENT_JOINS = `
  LEFT JOIN contractors co ON co.id = d.contractor_id AND co.tenant_id = d.tenant_id
  LEFT JOIN contractor_subcontractors sc ON sc.id = d.subcontractor_id AND sc.tenant_id = d.tenant_id
  LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
  OUTER APPLY (
    SELECT TOP 1
      COALESCE(a.reviewed_at, hist.performed_at) AS reviewed_at,
      COALESCE(u.full_name, hist_u.full_name) AS facility_approved_by_name
    FROM cc_fleet_applications a
    LEFT JOIN users u ON u.id = a.reviewed_by_user_id
    OUTER APPLY (
      SELECT TOP 1 h.performed_at, h.performed_by_user_id
      FROM cc_fleet_application_history h
      WHERE h.fleet_application_id = a.id AND h.[action] = N'approved'
      ORDER BY h.performed_at DESC
    ) hist
    LEFT JOIN users hist_u ON hist_u.id = hist.performed_by_user_id
    WHERE a.tenant_id = d.tenant_id AND a.entity_type = N'driver' AND a.entity_id = d.id
      AND COALESCE(a.reviewed_at, hist.performed_at) IS NOT NULL
    ORDER BY COALESCE(a.reviewed_at, hist.performed_at) DESC
  ) facility_app`;
