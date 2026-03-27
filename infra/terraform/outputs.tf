output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC identifier"
}

output "rds_endpoint" {
  value       = aws_db_instance.sqlserver.address
  description = "RDS SQL Server endpoint"
}

output "rds_port" {
  value       = aws_db_instance.sqlserver.port
  description = "RDS SQL Server port"
}

output "app_secret_arn" {
  value       = aws_secretsmanager_secret.app_env.arn
  description = "Secret ARN containing app runtime environment variables"
}

output "api_ecr_repository_url" {
  value       = aws_ecr_repository.api.repository_url
  description = "ECR repository URL for API image pushes"
}

output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.id
  description = "S3 bucket for frontend artifacts"
}
