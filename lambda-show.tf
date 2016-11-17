# https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
variable "asg_lambda_file-show" {
  description            = "File to use for the ASG Lambda function"
  default                = "./core/main/asg_lambda-show.zip"
}

resource "aws_lambda_function" "autoscaling_event_update_route53-show" {
  function_name          = "autoscaling_event_update_route53-show"

  filename               = "${var.asg_lambda_file-show}"
  source_code_hash       = "${base64sha256(file("${var.asg_lambda_file-show}"))}"
  handler                = "asg_lambda-show.handler"

  runtime                = "nodejs4.3"
  memory_size            = 128
  timeout                = 10

  role                   = "${aws_iam_role.ASGNotify.arn}"

  vpc_config {
    subnet_ids           = [
      "${aws_subnet.main_0.id}",
      "${aws_subnet.main_1.id}",
      "${aws_subnet.main_2.id}"
    ]

    security_group_ids     = [
      "${aws_security_group.main-all.id}",
      "${aws_default_security_group.main_default.id}"
    ]
  }
}
