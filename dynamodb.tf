resource "aws_dynamodb_table" "autoscaling_event_update_route53-blabla" {
  name                   = "autoscaling_event_update_route53-blabla"
  read_capacity          = 10
  write_capacity         = 10

  hash_key               = "HostNumber"
  range_key              = "IPAddress"

  attribute {
    name                 = "HostNumber"
    type                 = "N"
  }

  attribute {
    name                 = "IPAddress"
    type                 = "S"
  }
}
