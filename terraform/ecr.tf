# ================================================================
# ECR — Elastic Container Registry (Docker image storage on AWS)
# ================================================================
# ECR is like Docker Hub or GHCR, but private and inside AWS.
# ECS Fargate pulls images from ECR to run your containers.
#
# Why not use GHCR?
#   - ECR is in the same AWS network = faster pulls
#   - No need for separate authentication setup
#   - Integrated with IAM permissions
#   - Image scanning for vulnerabilities built-in
# ================================================================

resource "aws_ecr_repository" "api" {
  name                 = "${var.project_name}/api"
  image_tag_mutability = "MUTABLE"     # Allow overwriting :latest tag

  # Scan images for vulnerabilities on push
  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-api-ecr"
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project_name}/web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-web-ecr"
  }
}

resource "aws_ecr_repository" "bot" {
  name                 = "${var.project_name}/bot"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-bot-ecr"
  }
}

# ── Lifecycle Policy ──
# Auto-delete old images to save storage costs.
# Keep only the last 10 images per repository.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}
