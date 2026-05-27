# ================================================================
# DEV ENVIRONMENT VALUES
# ================================================================
# This file contains variable values for the dev environment.
# Usage: terraform apply -var-file="dev.tfvars"
#
# You'd have separate files for each environment:
#   dev.tfvars     — small instances, single AZ, no multi-AZ DB
#   staging.tfvars — medium instances, mirrors prod setup
#   prod.tfvars    — large instances, multi-AZ, deletion protection
# ================================================================

project_name = "digital-twin"
environment  = "dev"
aws_region   = "us-east-1"

# Networking
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Database (smallest possible for dev)
db_instance_class = "db.t3.micro"
db_name           = "digital_twin"
db_username       = "postgres"
db_password       = "change-this-in-production"    # Use Secrets Manager in prod!

# ECS (minimal resources for dev)
api_cpu           = 256      # 0.25 vCPU
api_memory        = 512      # 512 MB
api_desired_count = 1        # Single instance for dev

# Docker images (from our GitHub Actions pipeline)
api_image = "ghcr.io/sukhoisu30/digital-twin-api:latest"
web_image = "ghcr.io/sukhoisu30/digital-twin-web:latest"

# Redis
redis_node_type = "cache.t3.micro"
