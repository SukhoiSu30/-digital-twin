# ================================================================
# OUTPUTS — Values displayed after terraform apply
# ================================================================
# Outputs are like "return values" from your Terraform code.
# After running "terraform apply", these values are printed
# so you know the URLs, endpoints, and IDs of what was created.
#
# They can also be used by other Terraform modules or scripts.
# ================================================================

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "alb_dns_name" {
  description = "DNS name of the load balancer (your app's URL)"
  value       = aws_lb.main.dns_name
  # This is how you access your app after deployment
  # Example: digital-twin-dev-alb-123456.us-east-1.elb.amazonaws.com
}

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.postgres.endpoint
  # Example: digital-twin-dev-db.abc123.us-east-1.rds.amazonaws.com:5432
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the API ECS service"
  value       = aws_ecs_service.api.name
}

# Useful for CI/CD — these values can be read by GitHub Actions
# to deploy updated images to the right cluster/service
output "deployment_info" {
  description = "Info needed for CI/CD deployment"
  value = {
    region       = var.aws_region
    cluster      = aws_ecs_cluster.main.name
    service      = aws_ecs_service.api.name
    alb_url      = "http://${aws_lb.main.dns_name}"
  }
}
