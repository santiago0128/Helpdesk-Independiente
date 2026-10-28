SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF OBJECT_ID(N'dbo.hd_roles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hd_roles (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    role_key NVARCHAR(30) NOT NULL UNIQUE,
    display_name NVARCHAR(120) NOT NULL,
    description NVARCHAR(300) NULL,
    permissions NVARCHAR(MAX) NOT NULL CONSTRAINT DF_hd_roles_permissions DEFAULT N'[]',
    active BIT NOT NULL CONSTRAINT DF_hd_roles_active DEFAULT 1,
    built_in BIT NOT NULL CONSTRAINT DF_hd_roles_built_in DEFAULT 0,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_roles_created DEFAULT SYSUTCDATETIME()
  );
END;

IF COL_LENGTH(N'dbo.hd_users', N'role_id') IS NULL
BEGIN
  ALTER TABLE dbo.hd_users ADD role_id INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_hd_users_role')
BEGIN
  ALTER TABLE dbo.hd_users ADD CONSTRAINT FK_hd_users_role
    FOREIGN KEY (role_id) REFERENCES dbo.hd_roles(id) ON DELETE SET NULL;
END;

IF NOT EXISTS (SELECT 1 FROM dbo.hd_roles WHERE role_key = N'ADMIN')
BEGIN
  INSERT INTO dbo.hd_roles (role_key, display_name, description, permissions, active, built_in)
  VALUES (N'ADMIN', N'Administrador', N'Acceso completo a la mesa de ayuda.',
    N'["VIEW_TICKETS","CREATE_TICKETS","UPDATE_TICKETS","ASSIGN_TICKETS","MANAGE_USERS","MANAGE_ROLES"]', 1, 1);
END;
IF NOT EXISTS (SELECT 1 FROM dbo.hd_roles WHERE role_key = N'AGENT')
BEGIN
  INSERT INTO dbo.hd_roles (role_key, display_name, description, permissions, active, built_in)
  VALUES (N'AGENT', N'Agente', N'Gestiona y da seguimiento a los tickets asignados.',
    N'["VIEW_TICKETS","CREATE_TICKETS","UPDATE_TICKETS","ASSIGN_TICKETS"]', 1, 1);
END;

UPDATE u SET role_id = r.id
FROM dbo.hd_users u
JOIN dbo.hd_roles r ON r.role_key = CASE WHEN u.role = N'ADMIN' THEN N'ADMIN' ELSE N'AGENT' END
WHERE u.role_id IS NULL;
