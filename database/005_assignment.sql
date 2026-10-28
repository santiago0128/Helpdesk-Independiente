SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF COL_LENGTH(N'dbo.hd_tickets', N'assigned_user_id') IS NULL
BEGIN
  ALTER TABLE dbo.hd_tickets ADD assigned_user_id INT NULL;
  ALTER TABLE dbo.hd_tickets ADD CONSTRAINT FK_hd_tickets_assigned_user
    FOREIGN KEY (assigned_user_id) REFERENCES dbo.hd_users(id) ON DELETE SET NULL;
  CREATE INDEX IX_hd_tickets_assigned_user ON dbo.hd_tickets(assigned_user_id, updated_at DESC);
END;
