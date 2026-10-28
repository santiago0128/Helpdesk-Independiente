SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF OBJECT_ID(N'dbo.hd_tickets', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_tickets (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ticket_code AS ('HD-' + RIGHT('000000' + CONVERT(VARCHAR(12), id), 6)) PERSISTED,
    external_id NVARCHAR(120) NULL,
    source NVARCHAR(80) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    description NVARCHAR(MAX) NOT NULL,
    priority NVARCHAR(20) NOT NULL CONSTRAINT DF_hd_tickets_priority DEFAULT N'MEDIUM',
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_hd_tickets_status DEFAULT N'OPEN',
    requester_name NVARCHAR(200) NULL,
    requester_email NVARCHAR(254) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_tickets_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_tickets_updated DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_hd_tickets_updated ON dbo.hd_tickets(updated_at DESC, id DESC);
  CREATE UNIQUE INDEX UX_hd_tickets_external ON dbo.hd_tickets(source, external_id) WHERE external_id IS NOT NULL;
END;
IF OBJECT_ID(N'dbo.hd_messages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_messages (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ticket_id INT NOT NULL,
    author_type NVARCHAR(20) NOT NULL,
    author_name NVARCHAR(200) NULL,
    message NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_messages_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_hd_messages_ticket FOREIGN KEY(ticket_id) REFERENCES dbo.hd_tickets(id) ON DELETE CASCADE
  );
END;
IF OBJECT_ID(N'dbo.hd_tokens', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_tokens (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(120) NOT NULL,
    source NVARCHAR(80) NOT NULL,
    token_type NVARCHAR(20) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    token_prefix VARCHAR(20) NOT NULL,
    active BIT NOT NULL CONSTRAINT DF_hd_tokens_active DEFAULT 1,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_tokens_created DEFAULT SYSUTCDATETIME(),
    last_used_at DATETIME2(3) NULL
  );
END;
