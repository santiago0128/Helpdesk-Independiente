SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF OBJECT_ID(N'dbo.hd_attachments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_attachments (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ticket_id INT NOT NULL,
    original_name NVARCHAR(255) NOT NULL,
    storage_name VARCHAR(180) NOT NULL UNIQUE,
    mime_type NVARCHAR(160) NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_by NVARCHAR(160) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_attachments_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_hd_attachments_ticket FOREIGN KEY(ticket_id) REFERENCES dbo.hd_tickets(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_hd_attachments_ticket ON dbo.hd_attachments(ticket_id, created_at, id);
END;
