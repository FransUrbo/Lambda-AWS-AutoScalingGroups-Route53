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

resource "aws_iam_role_policy" "ASGNotifyPolicy_WRITE_LOG" {
  name                        = "ASGNotifyPolicy_WRITE_LOG"

  role                        = "${aws_iam_role.ASGNotify.id}"
  policy                      = <<ASG_NOTIFY_POLICY_WRITE_LOG
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup"
      ],
      "Resource": "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/autoscaling_event_update_route53*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_LOG
}

# Needed to update the Name tag with the individual number.
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

# => Resource arn:aws:route53:eu-west-1:955935045027:hostedzone/* can not contain region information.
# => Resource arn:aws:route53::955935045027:hostedzone/* cannot contain an account id.
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
        "ec2:DeleteNetworkInterface"
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
      "Principal": {
        "Service": [
          "ec2.amazonaws.com",
          "lambda.amazonaws.com"
        ]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
ASG_NOTIFY
}
