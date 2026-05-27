# ================================================================
# NETWORKING — VPC, Subnets, Internet Gateway, NAT, Route Tables
# ================================================================
# This is the foundation. Before you can run containers or databases,
# you need a network for them to live in.
#
# Think of it like building a house:
#   VPC          = the plot of land (your private network)
#   Subnets      = rooms in the house (public-facing vs private)
#   Internet GW  = the front door (connects to the internet)
#   NAT Gateway  = a mailbox (private rooms can send mail out,
#                  but nobody can walk in uninvited)
#   Route Tables = hallways (rules for how traffic flows)
# ================================================================

# ── VPC (Virtual Private Cloud) ──
# Your own isolated network in AWS. Nothing can get in or out
# unless you explicitly allow it.
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr          # 10.0.0.0/16 = 65,536 IPs
  enable_dns_support   = true                  # Allow DNS resolution inside VPC
  enable_dns_hostnames = true                  # Give resources DNS names

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc"
  }
}

# ── PUBLIC SUBNETS ──
# These have direct internet access (via Internet Gateway).
# Used for: Load Balancer, NAT Gateway
# NOT for: databases, app servers (those go in private subnets)
resource "aws_subnet" "public" {
  count = length(var.availability_zones)       # Create one per AZ

  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"    # 10.0.1.0/24, 10.0.2.0/24
  availability_zone = var.availability_zones[count.index]

  # Instances in this subnet get public IPs automatically
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-${var.environment}-public-${var.availability_zones[count.index]}"
    Tier = "public"
  }
}

# ── PRIVATE SUBNETS ──
# No direct internet access. Resources here are hidden from the world.
# Used for: ECS containers, RDS database, ElastiCache Redis
# They can still REACH the internet (via NAT) but nobody can reach THEM.
resource "aws_subnet" "private" {
  count = length(var.availability_zones)

  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"   # 10.0.10.0/24, 10.0.11.0/24
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-private-${var.availability_zones[count.index]}"
    Tier = "private"
  }
}

# ── INTERNET GATEWAY ──
# The "front door" of your VPC. Connects public subnets to the internet.
# Without this, nothing in the VPC can talk to the outside world.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-${var.environment}-igw"
  }
}

# ── ELASTIC IP for NAT Gateway ──
# A static public IP address that the NAT Gateway uses.
# This means all outbound traffic from private subnets appears
# to come from this one IP (useful for whitelisting).
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.environment}-nat-eip"
  }
}

# ── NAT GATEWAY ──
# Sits in a public subnet. Lets private subnet resources
# reach the internet (e.g., to pull Docker images, call APIs)
# WITHOUT exposing them to incoming traffic.
#
# Cost: ~$32/month. For dev, you might skip this and use a
# VPC endpoint instead. But for interviews, know what it does.
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id    # Lives in first public subnet

  tags = {
    Name = "${var.project_name}-${var.environment}-nat"
  }

  # NAT Gateway needs the Internet Gateway to exist first
  depends_on = [aws_internet_gateway.main]
}

# ── ROUTE TABLES ──
# Rules that tell traffic where to go.
# Like a GPS: "To reach the internet, go through the Internet Gateway"

# Public route table: traffic to 0.0.0.0/0 (anywhere) goes to Internet Gateway
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"                  # All traffic
    gateway_id = aws_internet_gateway.main.id  # Goes to Internet Gateway
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-public-rt"
  }
}

# Private route table: traffic to 0.0.0.0/0 goes to NAT Gateway
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"              # All traffic
    nat_gateway_id = aws_nat_gateway.main.id   # Goes through NAT
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-private-rt"
  }
}

# ── ROUTE TABLE ASSOCIATIONS ──
# Connect subnets to their route tables.
# "This subnet uses THIS set of routing rules"

resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
