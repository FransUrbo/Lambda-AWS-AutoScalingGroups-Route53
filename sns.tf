resource "aws_sns_topic" "instances-access" {
  name                        = "instances-access"
}

resource "aws_sns_topic_policy" "instances-access" {
  arn                         = "${aws_sns_topic.instances-access.arn}"

  policy                      = <<SNS_INSTANCES_ACCESS_POLICY
{
  "Version": "2012-10-17",
  "Statement":[
    {
      "Effect": "Allow",
      "Action": [
        "SNS:Publish"
      ],
      "Principal": {
        "AWS": [
          "<REMOTE_ACCOUNT_ID_#1>",
          "<REMOTE_ACCOUNT_ID_#2>"
        ]
      },
      "Resource": "${aws_sns_topic.instances-access.arn}"
    }
  ]
}
SNS_INSTANCES_ACCESS_POLICY
}
