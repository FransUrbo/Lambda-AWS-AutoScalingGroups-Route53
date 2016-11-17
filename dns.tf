resource "aws_route53_zone" "main" {
  name                 = "${var.dns_zone}"
  vpc_id               = "${aws_vpc.main.id}"
  comment              = "Internal DNS zone"
  force_destroy        = "true"

  tags {
    Name               = "main"
    environment        = "core"
    service            = "main"
  }
}

resource "aws_route53_record" "elasticache" {
 zone_id               = "${aws_route53_zone.main.zone_id}"
 name                  = "elasticache.${var.dns_zone}"
 type                  = "CNAME"
 ttl                   = "300"
 records               = ["${aws_elasticache_replication_group.autoscaling_event_update_route53.primary_endpoint_address}"]
}
