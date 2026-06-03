# ================================================================
# SECURITY GROUPS — Firewall rules for each service
# ================================================================
# A Security Group is a virtual firewall that controls
# inbound (ingress) and outbound (egress) traffic.
#
# Key concept: Security Groups are STATEFUL.
# If you allow inbound traffic on port 80, the response
# is automatically allowed out. You don't need a separate
# outbound rule for responses.
#
# Default behavior:
#   - All INBOUND traffic is DENIED (you must explicitly allow)
#   - All OUTBOUND traffic is ALLOWED
# ================================================================

# ── ALB Security Group ──
# The load balancer is the ONLY thing exposed to the internet.
# It accepts HTTP (80) and HTTPS (443) from anywhere.
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from anywhere
  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]    # 0.0.0.0/0 = the entire internet
  }

  # Allow HTTPS from anywhere
  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow all outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"             # -1 = all protocols
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-alb-sg"
  }

  # Terraform destroys and recreates SGs on name change.
  # lifecycle rule creates new one before destroying old one.
  lifecycle {
    create_before_destroy = true
  }
}

# ── ECS Tasks Security Group ──
# Your API containers. They ONLY accept traffic from the ALB.
# Nobody on the internet can reach them directly.
resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-"
  description = "Security group for ECS tasks (containers)"
  vpc_id      = aws_vpc.main.id

  # Only allow traffic FROM the ALB security group
  # This is the power of SG-to-SG references:
  # instead of allowing an IP range, you say "allow traffic
  # from any resource that has the ALB security group"
  ingress {
    description     = "API from ALB only"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Frontend from ALB only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Allow outbound (to reach database, Redis, internet via NAT)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── RDS Security Group ──
# Database. ONLY accepts connections from ECS tasks.
# Not from the internet, not from the ALB — only your app.
resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-${var.environment}-rds-"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from ECS only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]   # Only from ECS!
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-rds-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── Redis Security Group ──
# Same idea: only ECS tasks can reach Redis.
resource "aws_security_group" "redis" {
  name_prefix = "${var.project_name}-${var.environment}-redis-"
  description = "Security group for ElastiCache Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS only"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]   # Only from ECS!
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-redis-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}
