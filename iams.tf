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
        "ec2:Describe*",
        "autoscaling:Describe*"
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
      "Resource": "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/autoscaling_event:*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_LOG
}

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
        "route53:*"
      ],
      "Resource": "*"
    }
  ]
}
ASG_NOTIFY_POLICY_WRITE_R53
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
        "Service": "ec2.amazonaws.com",
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
ASG_NOTIFY
}
