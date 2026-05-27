# ================================================================
# VARIABLES — Input parameters for your infrastructure
# ================================================================
# Variables make your Terraform code reusable.
# Instead of hardcoding "us-east-1" everywhere, you define it once
# as a variable. Different environments (dev, staging, prod) just
# pass different values.
#
# How variables get their values (in order of priority):
#   1. Command line:  terraform apply -var="aws_region=us-west-2"
#   2. .tfvars file:  terraform apply -var-file="prod.tfvars"
#   3. Environment:   export TF_VAR_aws_region=us-west-2
#   4. Default value: defined below
# ================================================================

# ── General ──

variable "project_name" {
  description = "Name of the project (used in resource naming)"
  type        = string
  default     = "digital-twin"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"

  # Validation ensures only allowed values are used
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

# ── Networking ──

variable "vpc_cidr" {
  description = "CIDR block for the VPC (the IP range for your private network)"
  type        = string
  default     = "10.0.0.0/16"
  # /16 gives us 65,536 IP addresses — plenty for any project
  # 10.0.0.0/16 means IPs from 10.0.0.0 to 10.0.255.255
}

variable "availability_zones" {
  description = "AZs to deploy into (at least 2 for high availability)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
  # Each AZ is a separate data center. If one goes down,
  # the other keeps running. This is how AWS provides 99.99% uptime.
}

# ── Database ──

variable "db_instance_class" {
  description = "RDS instance size"
  type        = string
  default     = "db.t3.micro"
  # t3.micro = 2 vCPU, 1 GB RAM — cheapest option, good for dev
  # Production would use db.r6g.large or bigger
}

variable "db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "digital_twin"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Master password for the database"
  type        = string
  sensitive   = true    # Won't be shown in logs or plan output
  # In production, use AWS Secrets Manager instead of a variable
}

# ── ECS (Container Service) ──

variable "api_cpu" {
  description = "CPU units for API task (1024 = 1 vCPU)"
  type        = number
  default     = 256
  # 256 = 0.25 vCPU — cheapest Fargate option
}

variable "api_memory" {
  description = "Memory for API task in MB"
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Number of API containers to run"
  type        = number
  default     = 1
  # Dev = 1, Production = 2+ for high availability
}

variable "api_image" {
  description = "Docker image for the API service"
  type        = string
  default     = "ghcr.io/sukhoisu30/digital-twin-api:latest"
}

variable "web_image" {
  description = "Docker image for the frontend service"
  type        = string
  default     = "ghcr.io/sukhoisu30/digital-twin-web:latest"
}

# ── Redis ──

variable "redis_node_type" {
  description = "ElastiCache node size"
  type        = string
  default     = "cache.t3.micro"
  # t3.micro = cheapest option for dev
}
