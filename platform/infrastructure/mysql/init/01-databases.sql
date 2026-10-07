-- Runs once, when the MySQL volume is first created.
CREATE DATABASE IF NOT EXISTS platform_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON platform_test.* TO 'platform_migrator'@'%';
