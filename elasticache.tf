resource "aws_elasticache_replication_group" "autoscaling_event_update_route53" {
  replication_group_id          = "asgevnt-route53"
  replication_group_description = "Autoscaling events updating Route53"

  engine_version                = "3.2.4"
# NOTE: Automatic failover is not supported for T1 and T2 cache node types.
#  node_type                     = "cache.t2.micro"
  node_type                     = "cache.m3.medium"
# => The number of replicas per node group must be within 0 and 5.
  number_cache_clusters         = "${length(data.aws_availability_zones.available.names)}"
  port                          = 6379

  subnet_group_name             = "${aws_elasticache_subnet_group.main.name}"
# => Use of cache security groups is not permitted in this API version for your account.
#  security_group_ids            = ["${aws_elasticache_security_group.main.name}"]
  security_group_ids            = [
    "${aws_security_group.main-all.id}"
  ]
  parameter_group_name          = "default.redis3.2"

# => Automatic failover is not supported for T1 and T2 cache node types.
  automatic_failover_enabled    = "true"

  availability_zones            = ["${data.aws_availability_zones.available.names}"]

  apply_immediately             = "true"
# => Object or bucket does not exist for S3 object
#  snapshot_arns                 = ["arn:aws:s3:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.backup_bucket}/autoscaling_event_update_route53.rdb"]
# => The requested configuration does not support snapshotting. Snapshot window parameter should not be specified.
  snapshot_window               = "03:00-07:00"
# => The requested configuration does not support snapshotting. Snapshot retention limit parameter should not be specified.
  snapshot_retention_limit      = "5"

  maintenance_window            = "sun:01:00-sun:02:00"

  tags {
    Name                        = "autoscaling_event_update_route53"
    environment                 = "core"
    service                     = "main"
  }
}
