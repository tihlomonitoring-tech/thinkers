-- Customer-submitted diesel delivery requests; admin approves into fuel_diesel_orders.
-- Run: node scripts/run-fuel-customer-diesel-requests.js

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_customer_diesel_requests')
BEGIN
  CREATE TABLE fuel_customer_diesel_requests (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    requesting_user_id UNIQUEIDENTIFIER NOT NULL,
    liters_required DECIMAL(12,2) NOT NULL,
    priority NVARCHAR(40) NOT NULL,
    due_date DATE NOT NULL,
    request_type NVARCHAR(40) NOT NULL,
    delivery_site_name NVARCHAR(255) NOT NULL,
    delivery_site_address NVARCHAR(500) NOT NULL,
    site_responsible_name NVARCHAR(200) NULL,
    site_responsible_phone NVARCHAR(80) NULL,
    site_responsible_email NVARCHAR(255) NULL,
    customer_notes NVARCHAR(MAX) NULL,
    status NVARCHAR(40) NOT NULL DEFAULT N'pending_admin',
    diesel_order_id UNIQUEIDENTIFIER NULL,
    reviewed_by_user_id UNIQUEIDENTIFIER NULL,
    reviewed_at DATETIME2 NULL,
    admin_notes NVARCHAR(MAX) NULL,
    rejection_reason NVARCHAR(500) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_cust_req_order FOREIGN KEY (diesel_order_id) REFERENCES fuel_diesel_orders (id) ON DELETE SET NULL
  );
  CREATE INDEX IX_fuel_cust_req_tenant ON fuel_customer_diesel_requests (tenant_id);
  CREATE INDEX IX_fuel_cust_req_status ON fuel_customer_diesel_requests (status);
  CREATE INDEX IX_fuel_cust_req_user ON fuel_customer_diesel_requests (requesting_user_id);
  CREATE INDEX IX_fuel_cust_req_order ON fuel_customer_diesel_requests (diesel_order_id);
END
GO
