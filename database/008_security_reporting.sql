SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF COL_LENGTH(N'dbo.hd_users', N'failed_login_count') IS NULL
  ALTER TABLE dbo.hd_users ADD failed_login_count INT NOT NULL CONSTRAINT DF_hd_users_failed_login_count DEFAULT 0;
IF COL_LENGTH(N'dbo.hd_users', N'locked_until') IS NULL
  ALTER TABLE dbo.hd_users ADD locked_until DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.hd_users', N'password_changed_at') IS NULL
  ALTER TABLE dbo.hd_users ADD password_changed_at DATETIME2(3) NULL;

IF OBJECT_ID(N'dbo.hd_password_reset_tokens', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_password_reset_tokens (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME2(3) NOT NULL,
    used_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_password_reset_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_hd_password_reset_user FOREIGN KEY(user_id) REFERENCES dbo.hd_users(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_hd_password_reset_lookup ON dbo.hd_password_reset_tokens(token_hash, expires_at, used_at);
END;

IF OBJECT_ID(N'dbo.hd_audit_log', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_audit_log (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    actor_user_id INT NULL,
    action NVARCHAR(80) NOT NULL,
    entity_type NVARCHAR(60) NULL,
    entity_id NVARCHAR(120) NULL,
    metadata NVARCHAR(MAX) NULL,
    ip_address NVARCHAR(64) NULL,
    user_agent NVARCHAR(500) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_audit_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_hd_audit_actor FOREIGN KEY(actor_user_id) REFERENCES dbo.hd_users(id) ON DELETE SET NULL
  );
  CREATE INDEX IX_hd_audit_created ON dbo.hd_audit_log(created_at DESC, id DESC);
  CREATE INDEX IX_hd_audit_entity ON dbo.hd_audit_log(entity_type, entity_id, created_at DESC);
END;

GO
