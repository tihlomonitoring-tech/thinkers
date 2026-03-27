variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "af-south-1"
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "thinkers"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "tags" {
  description = "Additional resource tags"
  type        = map(string)
  default     = {}
}

variable "vpc_cidr" {
  description = "VPC CIDR range"
  type        = string
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Two public subnet CIDR blocks"
  type        = list(string)
  default     = ["10.40.0.0/24", "10.40.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Two private subnet CIDR blocks"
  type        = list(string)
  default     = ["10.40.10.0/24", "10.40.11.0/24"]
}

variable "db_engine_version" {
  description = "RDS SQL Server engine version"
  type        = string
  default     = "15.00"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.small"
}

variable "db_allocated_storage_gb" {
  description = "Initial RDS storage allocation"
  type        = number
  default     = 50
}

variable "db_max_allocated_storage_gb" {
  description = "Max autoscaling storage for RDS"
  type        = number
  default     = 200
}

variable "db_multi_az" {
  description = "Whether to enable Multi-AZ on RDS"
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention window"
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Prevent accidental DB deletion"
  type        = bool
  default     = true
}

variable "db_master_username" {
  description = "RDS master username"
  type        = string
}

variable "db_master_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "app_sql_database_name" {
  description = "Application database name hosted in SQL Server"
  type        = string
}

variable "session_secret" {
  description = "Session secret for express-session"
  type        = string
  sensitive   = true
}

variable "frontend_origin" {
  description = "Frontend URL used by API CORS and link generation"
  type        = string
}

variable "email_user" {
  description = "SMTP username"
  type        = string
  default     = ""
}

variable "email_pass" {
  description = "SMTP password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "email_from_name" {
  description = "From name for email notifications"
  type        = string
  default     = "Thinkers"
}

variable "email_host" {
  description = "SMTP host"
  type        = string
  default     = ""
}

variable "email_port" {
  description = "SMTP port"
  type        = string
  default     = ""
}

variable "email_secure" {
  description = "SMTP secure flag"
  type        = string
  default     = ""
}
