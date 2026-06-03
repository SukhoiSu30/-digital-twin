# ================================================================
# APPLICATION LOAD BALANCER — Distributes traffic to containers
# ================================================================
# The ALB is the entry point from the internet to your app.
# It sits in public subnets and forwards traffic to ECS tasks
# running in private subnets.
#
# Why not let users hit containers directly?
#   1. Containers have private IPs (no internet access)
#   2. ALB distributes traffic across multiple containers
#   3. ALB does health checks and stops sending to unhealthy ones
#   4. ALB handles SSL/TLS termination (HTTPS)
#   5. ALB provides a single stable URL (containers come and go)
#
# This replaces Nginx from docker-compose. In production,
# you use ALB instead of running your own Nginx.
# ================================================================

# ── Application Load Balancer ──
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false                     # Internet-facing (not internal)
  load_balancer_type = "application"             # Layer 7 (HTTP/HTTPS)
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id   # Must be in public subnets

  # Access logs (optional, sends logs to S3)
  # access_logs {
  #   bucket  = aws_s3_bucket.alb_logs.bucket
  #   enabled = true
  # }

  tags = {
    Name = "${var.project_name}-${var.environment}-alb"
  }
}

# ── Target Group ──
# A target group is a set of targets (your ECS tasks) that the
# ALB forwards traffic to. Think of it as: ALB → Target Group → Containers
resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-${var.environment}-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"        # Fargate uses IP-based targets (not instance)

  # Health check — ALB checks if your containers are alive
  # If a container fails health checks, ALB stops sending traffic to it
  health_check {
    enabled             = true
    path                = "/api/health"          # Your health endpoint
    port                = "traffic-port"         # Same port as the target
    protocol            = "HTTP"
    healthy_threshold   = 2                      # 2 consecutive passes = healthy
    unhealthy_threshold = 3                      # 3 consecutive fails = unhealthy
    timeout             = 5
    interval            = 30
    matcher             = "200"                  # Expect HTTP 200 response
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-api-tg"
  }
}

# ── Frontend Target Group ──
resource "aws_lb_target_group" "web" {
  name        = "${var.project_name}-${var.environment}-web-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-web-tg"
  }
}

# ── Listener (HTTP) with path-based routing ──
# Same concept as our Kubernetes Ingress!
# /api/* → API service
# /*     → Frontend service
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Default action: send everything to frontend
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-http-listener"
  }
}

# ── Listener Rule: /api/* → API target group ──
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100    # Lower number = higher priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-api-rule"
  }
}
