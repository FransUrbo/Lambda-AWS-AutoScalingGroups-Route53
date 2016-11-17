resource "aws_security_group" "main-all" {
  name                         = "security-group"
  description                  = "ElastiCache security group (Allow all from 10/8)"
  vpc_id                       = "${aws_vpc.main.id}"

  ingress {
    from_port            = 0
    to_port              = 0
    protocol             = "-1"
    cidr_blocks          = ["10.0.0.0/8"]
  }

  egress {
    from_port            = 0
    to_port              = 0
    protocol             = "-1"
    cidr_blocks          = ["10.0.0.0/8"]
  }

  # ===
  tags {
    Name                 = "core-main-all"
    environment          = "core"
    service              = "main"
  }
}

# => Use of cache security groups is not permitted in this API version for your account.
#resource "aws_elasticache_security_group" "main" {
#  name                         = "elasticache-security-group"
#  security_group_names         = [
#    "${aws_security_group.main-all.name}"
#  ]
#}
