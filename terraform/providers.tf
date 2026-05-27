# ================================================================
# PROVIDERS — Tell Terraform which cloud to talk to
# ================================================================
# A "provider" is a plugin that lets Terraform manage resources
# on a specific platform (AWS, Azure, GCP, etc.)
# Think of it like a database driver — you need the right one
# to connect to the right database.
# ================================================================

# This block sets Terraform's own configuration
terraform {
  # Minimum Terraform version required
  required_version = ">= 1.0"

  # Which providers we need and their versions
  required_providers {
    aws = {
      source  = "hashicorp/aws"    # Official AWS provider by HashiCorp
      version = "~> 5.0"           # Any 5.x version (5.0, 5.1, 5.72, etc.)
      # "~> 5.0" means >= 5.0 and < 6.0
      # We pin the major version to avoid breaking changes
    }
  }

  # ── BACKEND: Where to store Terraform state ──
  # Terraform tracks what it created in a "state file" (terraform.tfstate)
  # By default it's stored locally, but in a team you store it in S3
  # so everyone shares the same state.
  #
  # Uncomment this for production:
  # backend "s3" {
  #   bucket         = "digital-twin-terraform-state"
  #   key            = "infrastructure/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"    # Prevents two people running at once
  #   encrypt        = true
  # }
}

# Configure the AWS provider
provider "aws" {
  region = var.aws_region    # Which AWS region to create resources in

  # Tags applied to EVERY resource Terraform creates
  # This helps with cost tracking and resource identification
  default_tags {
    tags = {
      Project     = "digital-twin"
      ManagedBy   = "terraform"        # So people know not to edit manually
      Environment = var.environment
    }
  }
}
