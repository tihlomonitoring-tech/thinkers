terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-igw"
  })
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[0]
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-a"
  })
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[1]
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-b"
  })
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[0]
  availability_zone = data.aws_availability_zones.available.names[0]
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-a"
  })
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[1]
  availability_zone = data.aws_availability_zones.available.names[1]
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-b"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "ecs_service" {
  name        = "${local.name_prefix}-ecs-sg"
  description = "ECS service security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API traffic from ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "RDS SQL Server security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "SQL Server from ECS"
    from_port       = 1433
    to_port         = 1433
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  tags       = local.common_tags
}

resource "aws_db_instance" "sqlserver" {
  identifier             = "${replace(local.name_prefix, "_", "-")}-sqlserver"
  allocated_storage      = var.db_allocated_storage_gb
  max_allocated_storage  = var.db_max_allocated_storage_gb
  storage_type           = "gp3"
  engine                 = "sqlserver-ex"
  engine_version         = var.db_engine_version
  instance_class         = var.db_instance_class
  username               = var.db_master_username
  password               = var.db_master_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false
  backup_retention_period = var.db_backup_retention_days
  skip_final_snapshot    = false
  final_snapshot_identifier = "${replace(local.name_prefix, "_", "-")}-final-snapshot"
  storage_encrypted      = true
  deletion_protection    = var.db_deletion_protection
  apply_immediately      = false

  tags = local.common_tags
}

resource "aws_secretsmanager_secret" "app_env" {
  name                    = "${local.name_prefix}/thinkers/app-env"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_env" {
  secret_id = aws_secretsmanager_secret.app_env.id
  secret_string = jsonencode({
    # Use SQLSERVER_* not AWS_* — many AWS services forbid customer env vars starting with AWS_
    SQLSERVER_HOST             = aws_db_instance.sqlserver.address
    SQLSERVER_DATABASE         = var.app_sql_database_name
    SQLSERVER_USER             = var.db_master_username
    SQLSERVER_PASSWORD         = var.db_master_password
    SQLSERVER_PORT             = "1433"
    SESSION_SECRET             = var.session_secret
    FRONTEND_ORIGIN            = var.frontend_origin
    EMAIL_USER                 = var.email_user
    EMAIL_PASS                 = var.email_pass
    EMAIL_FROM_NAME            = var.email_from_name
    EMAIL_HOST                 = var.email_host
    EMAIL_PORT                 = var.email_port
    EMAIL_SECURE               = var.email_secure
  })
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = local.common_tags
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${replace(local.name_prefix, "_", "-")}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = local.common_tags
}

data "aws_caller_identity" "current" {}
