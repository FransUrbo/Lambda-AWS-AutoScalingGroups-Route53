resource "aws_internet_gateway" "main" {
  vpc_id                 = "${aws_vpc.main.id}"

  tags {
    Name                 = "core-main"
    environment          = "core"
    service              = "main"
  }
}

# ===

resource "aws_eip" "main-nat" {
  vpc                    = "true"
}

resource "aws_nat_gateway" "main" {
  allocation_id          = "${aws_eip.main-nat.id}"
  subnet_id              = "${aws_subnet.main_public.id}"
  depends_on             = ["aws_internet_gateway.main"]
}

resource "aws_route" "main" {
  route_table_id         = "${aws_route_table.main.id}"
  destination_cidr_block = "0.0.0.0/0"

  nat_gateway_id         = "${aws_nat_gateway.main.id}"
}
