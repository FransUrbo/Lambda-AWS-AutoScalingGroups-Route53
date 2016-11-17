resource "aws_vpc" "main" {
  cidr_block                  = "10.10.0.0/16"

  enable_dns_support          = "true"
  enable_dns_hostnames        = "true"

  tags {
    Name                      = "core-main"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table" "main" {
  vpc_id                      = "${aws_vpc.main.id}"

  tags {
    Name                      = "core-main"
    environment               = "core"
    service                   = "main"
  }
}

# ===

resource "aws_subnet" "main_0" {
  vpc_id                      = "${aws_vpc.main.id}"
  cidr_block                  = "10.10.0.0/24"
  availability_zone           = "${data.aws_availability_zones.available.names[0]}"
  map_public_ip_on_launch     = "true"

  depends_on                  = ["aws_internet_gateway.main"]

  tags {
    Name                      = "core-main_0"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table_association" "main_0" {
  subnet_id                   = "${aws_subnet.main_0.id}"
  route_table_id              = "${aws_route_table.main.id}"
}

# ===

resource "aws_subnet" "main_1" {
  vpc_id                      = "${aws_vpc.main.id}"
  cidr_block                  = "10.10.1.0/24"
  availability_zone           = "${data.aws_availability_zones.available.names[1]}"
  map_public_ip_on_launch     = "true"

  depends_on                  = ["aws_internet_gateway.main"]

  tags {
    Name                      = "core-main_1"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table_association" "main_1" {
  subnet_id                   = "${aws_subnet.main_1.id}"
  route_table_id              = "${aws_route_table.main.id}"
}

# ===

resource "aws_subnet" "main_2" {
  vpc_id                      = "${aws_vpc.main.id}"
  cidr_block                  = "10.10.2.0/24"
  availability_zone           = "${data.aws_availability_zones.available.names[2]}"
  map_public_ip_on_launch     = "true"

  depends_on                  = ["aws_internet_gateway.main"]

  tags {
    Name                      = "core-main_2"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table_association" "main_2" {
  subnet_id                   = "${aws_subnet.main_2.id}"
  route_table_id              = "${aws_route_table.main.id}"
}

# ===

resource "aws_subnet" "main_public" {
  vpc_id                      = "${aws_vpc.main.id}"
  cidr_block                  = "10.10.3.0/24"
  availability_zone           = "${data.aws_availability_zones.available.names[0]}"

  depends_on                  = ["aws_internet_gateway.main"]

  tags {
    Name                      = "core-main_public"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table" "main_public" {
  vpc_id                      = "${aws_vpc.main.id}"

  tags {
    Name                      = "core-main_public"
    environment               = "core"
    service                   = "main"
  }
}

resource "aws_route_table_association" "main_public" {
  subnet_id                   = "${aws_subnet.main_public.id}"
  route_table_id              = "${aws_route_table.main_public.id}"
}

resource "aws_route" "main_public" {
  route_table_id            = "${aws_route_table.main_public.id}"
  destination_cidr_block    = "0.0.0.0/0"

  gateway_id                = "${aws_internet_gateway.main.id}"
}

# ===

resource "aws_main_route_table_association" "main_public" {
  vpc_id                      = "${aws_vpc.main.id}"
  route_table_id              = "${aws_route_table.main_public.id}"
}

resource "aws_default_security_group" "main_default" {
  vpc_id                      = "${aws_vpc.main.id}"

  ingress {
    protocol                  = -1
    self                      = true
    from_port                 = 0
    to_port                   = 0
  }

  egress {
    from_port                 = 0
    to_port                   = 0
    protocol                  = "-1"
    cidr_blocks               = ["0.0.0.0/0"]
  }

  tags {
    Name                      = "core-main-default"
    environment               = "core"
    service                   = "main"
  }
}

# ===

resource "aws_elasticache_subnet_group" "main" {
  name                        = "elasticache-subnet-group"
  description                 = "Autoscaling events updating Route53"

  subnet_ids                  = [
    "${aws_subnet.main_0.id}",
    "${aws_subnet.main_1.id}",
    "${aws_subnet.main_2.id}"
  ]
}
