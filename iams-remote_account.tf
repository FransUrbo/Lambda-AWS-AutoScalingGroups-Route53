resource "aws_iam_role_policy" "ASGNotifyPolicy_READ" {
  name                        = "ASGNotifyPolicy_READ"

  role                        = "${aws_iam_role.ASGNotify.id}"
  policy                      = <<ASG_NOTIFY_POLICY_READ
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "iam:GetInstanceProfile",
        "autoscaling:DescribeTags",
        "autoscaling:DescribeAutoScalingGroups",
        "route53:ListHostedZones",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "*"
    }
  ]
}
ASG_NOTIFY_POLICY_READ
}

# => Resource arn:aws:route53:eu-west-1:<ORIGIN_ACCOUNT_ID>:hostedzone/* can not contain region information.
# => Resource arn:aws:route53::<ORIGIN_ACCOUNT_ID>:hostedzone/* cannot contain an account id.
resource "aws_iam_role_policy" "ASGNotifyPolicy_WRITE_R53" {
  name                        = "ASGNotifyPolicy_WRITE_R53"

  role                        = "${aws_iam_role.ASGNotify.id}"
  policy                      = <<ASG_NOTIFY_POLICY_WRITE_R53
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_R53
}

resource "aws_iam_role_policy" "ASGNotifyPolicy_WRITE_EC2" {
  name                        = "ASGNotifyPolicy_WRITE_EC2"

  role                        = "${aws_iam_role.ASGNotify.id}"
  policy                      = <<ASG_NOTIFY_POLICY_WRITE_EC2
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateTags"
      ],
      "Resource": "*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_EC2
}

resource "aws_iam_role_policy" "ASGNotifyPolicy_WRITE_VPC" {
  name                        = "ASGNotifyPolicy_WRITE_VPC"

  role                        = "${aws_iam_role.ASGNotify.id}"
  policy                      = <<ASG_NOTIFY_POLICY_WRITE_VPC
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeNetworkInterfaces"
      ],
      "Resource": "*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_VPC
}

resource "aws_iam_role" "ASGNotify" {
  name                        = "ASGNotify"
  assume_role_policy          = <<ASG_NOTIFY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": [
          "ec2.amazonaws.com",
          "lambda.amazonaws.com",
          "apigateway.amazonaws.com"
        ]
      }
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<ORIGIN_ACCOUNT_ID>:role/ASGNotify"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
ASG_NOTIFY
}
