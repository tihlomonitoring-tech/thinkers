-- Optional link from contractor library documents to a truck or driver (fleet).
-- Run: node scripts/run-contractor-library-entity-links.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_library_documents') AND name = 'linked_entity_type')
  ALTER TABLE contractor_library_documents ADD linked_entity_type NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_library_documents') AND name = 'linked_entity_id')
  ALTER TABLE contractor_library_documents ADD linked_entity_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_contractor_library_linked_entity_type' AND parent_object_id = OBJECT_ID('contractor_library_documents'))
  ALTER TABLE contractor_library_documents ADD CONSTRAINT CK_contractor_library_linked_entity_type
    CHECK (linked_entity_type IS NULL OR linked_entity_type IN (N'truck', N'driver'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contractor_library_linked_entity' AND object_id = OBJECT_ID('contractor_library_documents'))
  CREATE INDEX IX_contractor_library_linked_entity ON contractor_library_documents(tenant_id, linked_entity_type, linked_entity_id);
GO
