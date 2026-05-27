# ================================================================
# ECS FARGATE — Run Docker containers without managing servers
# ================================================================
# ECS (Elastic Container Service) runs your Docker containers.
# Fargate is the "serverless" mode — you don't manage EC2 instances.
# You just say "run this container with 256 CPU and 512 MB RAM"
# and AWS handles the rest.
#
# ECS hierarchy:
#   Cluster → Service → Task → Container
#
#   Cluster  = logical grouping (like a Kubernetes cluster)
#   Service  = keeps N copies of your task running (like k8s Deployment)
#   Task     = a running instance (like a k8s Pod)
#   Task Def = the blueprint/recipe (like a k8s Pod spec)
# ================================================================

# ── ECS Cluster ──
# A logical grouping for your services. All tasks run inside this cluster.
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  # Enable Container Insights for monitoring
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-cluster"
  }
}

# ── IAM Role for ECS Task Execution ──
# ECS needs permission to:
#   - Pull Docker images from GHCR/ECR
#   - Write logs to CloudWatch
#   - Read secrets from SSM/Secrets Manager
# This is the role that the ECS agent (not your app) uses.
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-${var.environment}-ecs-execution"

  # "Trust policy" — who can assume this role
  # Here, we say "only the ECS service can use this role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# Attach the AWS-managed policy for ECS task execution
resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  # This managed policy allows: ECR image pull, CloudWatch logs
}

# ── IAM Role for ECS Task (your app's permissions) ──
# This is the role YOUR APPLICATION uses at runtime.
# If your app needs to call AWS services (S3, SES, Bedrock),
# you add permissions here.
resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# ── CloudWatch Log Group ──
# Where container logs go (replaces `docker logs`)
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}-${var.environment}/api"
  retention_in_days = 30     # Keep logs for 30 days, then auto-delete

  tags = {
    Name = "${var.project_name}-${var.environment}-api-logs"
  }
}

# ── Task Definition (API) ──
# The "recipe" for running your API container.
# Like docker-compose service definition, but for AWS.
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"        # Each task gets its own IP
  cpu                      = var.api_cpu     # 256 = 0.25 vCPU
  memory                   = var.api_memory  # 512 MB
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  # Container definition — equivalent to a docker-compose service
  container_definitions = jsonencode([{
    name  = "api"
    image = var.api_image    # ghcr.io/sukhoisu30/digital-twin-api:latest

    # Port mapping — like "ports: 3000:3000" in docker-compose
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    # Environment variables — like "environment:" in docker-compose
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      {
        name  = "DATABASE_URL"
        value = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
        # Notice: instead of "postgres:5432" (Docker DNS), we use the
        # actual RDS endpoint. Terraform fills this in automatically
        # because we reference aws_db_instance.postgres.endpoint
      },
      {
        name  = "REDIS_URL"
        value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
      },
    ]

    # Logging — send container stdout to CloudWatch
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }

    # Health check — same concept as Docker healthcheck
    healthCheck = {
      command     = ["CMD-SHELL", "wget --spider -q http://localhost:3000/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }
  }])

  tags = {
    Name = "${var.project_name}-${var.environment}-api-task"
  }
}

# ── ECS Service (API) ──
# Keeps your desired number of tasks running.
# If a container crashes, ECS automatically starts a new one.
# Like "restart: unless-stopped" in docker-compose, but smarter.
resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count    # How many copies to run
  launch_type     = "FARGATE"

  # Network configuration
  network_configuration {
    subnets          = aws_subnet.private[*].id              # Run in private subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false                                  # No public IP needed
  }

  # Connect to the load balancer
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Deployment configuration
  deployment_minimum_healthy_percent = 50     # Keep at least 50% running during deploy
  deployment_maximum_percent         = 200    # Can temporarily run 2x containers

  # Don't try to create service before ALB target group is ready
  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project_name}-${var.environment}-api-service"
  }
}
