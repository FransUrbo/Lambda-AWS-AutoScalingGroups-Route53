data "aws_availability_zones" "available" {}
data "aws_caller_identity" "current" { }
data "aws_region" "current" {
  current = true
}

variable "dns_zone" {}
variable "backup_bucket" {
    description = "Name of S3 backup bucket"
    default     = "my-backup-bucket"
}
