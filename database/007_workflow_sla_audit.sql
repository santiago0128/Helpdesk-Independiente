SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF COL_LENGTH(N'dbo.hd_tickets', N'sla_first_response_due_at') IS NULL
  ALTER TABLE dbo.hd_tickets ADD sla_first_response_due_at DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.hd_tickets', N'sla_resolution_due_at') IS NULL
  ALTER TABLE dbo.hd_tickets ADD sla_resolution_due_at DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.hd_tickets', N'first_response_at') IS NULL
  ALTER TABLE dbo.hd_tickets ADD first_response_at DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.hd_tickets', N'resolved_at') IS NULL
  ALTER TABLE dbo.hd_tickets ADD resolved_at DATETIME2(3) NULL;

IF OBJECT_ID(N'dbo.hd_ticket_events', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_ticket_events (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ticket_id INT NOT NULL,
    actor_user_id INT NULL,
    event_type NVARCHAR(40) NOT NULL,
    from_value NVARCHAR(500) NULL,
    to_value NVARCHAR(500) NULL,
    message NVARCHAR(1000) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_ticket_events_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_hd_ticket_events_ticket FOREIGN KEY(ticket_id) REFERENCES dbo.hd_tickets(id) ON DELETE CASCADE,
    CONSTRAINT FK_hd_ticket_events_actor FOREIGN KEY(actor_user_id) REFERENCES dbo.hd_users(id) ON DELETE SET NULL
  );
  CREATE INDEX IX_hd_ticket_events_ticket ON dbo.hd_ticket_events(ticket_id, created_at, id);
END;

UPDATE dbo.hd_tickets SET
  sla_first_response_due_at = COALESCE(sla_first_response_due_at, DATEADD(HOUR, CASE priority WHEN N'URGENT' THEN 1 WHEN N'HIGH' THEN 4 WHEN N'LOW' THEN 16 ELSE 8 END, created_at)),
  sla_resolution_due_at = COALESCE(sla_resolution_due_at, DATEADD(HOUR, CASE priority WHEN N'URGENT' THEN 4 WHEN N'HIGH' THEN 16 WHEN N'LOW' THEN 80 ELSE 40 END, created_at));
