# Terraform Bootstrap (AWS)

This folder bootstraps the AWS baseline for Thinkers migration:

- VPC + subnets
- Security groups
- RDS SQL Server
- Secrets Manager secret for API runtime values
- ECR repo for API image
- S3 bucket for frontend artifacts

## Prerequisites

- Terraform `>= 1.5`
- AWS credentials configured (`aws configure` or environment variables)
- Region chosen (default in this repo: `af-south-1`)

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

## Notes

- The baseline intentionally does **not** modify Azure resources.
- ECS service, ALB listeners/routing, CloudFront distribution, and Route53 records are handled as the next implementation layer once database migration validation is complete.
- Keep `terraform.tfvars` out of source control if it contains secrets.
