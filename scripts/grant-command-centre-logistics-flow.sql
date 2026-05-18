-- Grant Command Centre tab "logistics_flow" to users who have truck_update_records or trends.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'command_centre_grants')
  RETURN;
GO

INSERT INTO command_centre_grants (user_id, tab_id, granted_by_user_id)
SELECT g.user_id, N'logistics_flow', g.granted_by_user_id
FROM command_centre_grants g
WHERE g.tab_id IN (N'truck_update_records', N'trends')
  AND NOT EXISTS (
    SELECT 1 FROM command_centre_grants x
    WHERE x.user_id = g.user_id AND x.tab_id = N'logistics_flow'
  );
GO
