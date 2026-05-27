# ================================================================
# DATABASE — RDS PostgreSQL + ElastiCache Redis
# ================================================================
# These are MANAGED services. AWS handles:
#   - Automatic backups
#   - Security patches
#   - Failover (Multi-AZ)
#   - Monitoring
#
# This replaces the postgres and redis containers from docker-compose.
# In production, you never run databases in containers — you use
# managed services for reliability and automatic backups.
# ================================================================

# ── RDS Subnet Group ──
# Tells RDS which subnets it can use. We put it in private subnets
# so it's not accessible from the internet.
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet"
  subnet_ids = aws_subnet.private[*].id    # All private subnets
  # [*] is Terraform's "splat" operator — it gets all items from the list
  # Same as: [aws_subnet.private[0].id, aws_subnet.private[1].id]

  tags = {
    Name = "${var.project_name}-${var.environment}-db-subnet"
  }
}

# ── RDS PostgreSQL Instance ──
# Your production database. Replaces the postgres Docker container.
resource "aws_db_instance" "postgres" {
  identifier = "${var.project_name}-${var.environment}-db"

  # Engine configuration
  engine         = "postgres"
  engine_version = "16.3"                        # Same version as our Docker image
  instance_class = var.db_instance_class          # db.t3.micro for dev

  # Storage
  allocated_storage     = 20                      # 20 GB (minimum for gp3)
  max_allocated_storage = 100                     # Auto-scale up to 100 GB
  storage_type          = "gp3"                   # SSD storage, cheapest good option
  storage_encrypted     = true                    # Encrypt data at rest

  # Database configuration
  db_name  = var.db_name                          # "digital_twin"
  username = var.db_username                      # "postgres"
  password = var.db_password                      # From variable (sensitive)

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false                  # NOT accessible from internet

  # Backup
  backup_retention_period = 7                     # Keep backups for 7 days
  backup_window           = "03:00-04:00"         # Backup at 3 AM UTC

  # Maintenance
  maintenance_window        = "Mon:04:00-Mon:05:00"
  auto_minor_version_upgrade = true               # Auto-apply security patches

  # High Availability
  multi_az = var.environment == "prod" ? true : false
  # Multi-AZ creates a standby replica in another data center.
  # If the primary fails, AWS automatically switches to standby.
  # Doubles the cost, so only enable in production.

  # Deletion protection
  deletion_protection = var.environment == "prod" ? true : false
  skip_final_snapshot = var.environment == "prod" ? false : true
  # In prod, take a final snapshot before deleting. In dev, skip it.

  tags = {
    Name = "${var.project_name}-${var.environment}-postgres"
  }
}

# ── ElastiCache Subnet Group ──
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.project_name}-${var.environment}-redis-subnet"
  }
}

# ── ElastiCache Redis ──
# Managed Redis. Replaces the redis Docker container.
# Used for BullMQ job queues in our app.
resource "aws_elasticache_cluster" "redis" {
  cluster_id      = "${var.project_name}-${var.environment}-redis"
  engine          = "redis"
  engine_version  = "7.0"                         # Same as our Docker image
  node_type       = var.redis_node_type           # cache.t3.micro for dev
  num_cache_nodes = 1                             # Single node for dev
  port            = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # Maintenance
  maintenance_window = "Mon:05:00-Mon:06:00"

  tags = {
    Name = "${var.project_name}-${var.environment}-redis"
  }
}
