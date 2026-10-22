-- GORM AutoMigrate currently creates the development schema at startup.
-- Use versioned migrations (golang-migrate or Atlas) before production deployments.
CREATE DATABASE IF NOT EXISTS agent_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
