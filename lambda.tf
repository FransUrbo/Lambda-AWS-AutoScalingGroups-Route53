# https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
variable "asg_lambda_file" {
  description            = "File to use for the ASG Lambda function"
  default                = "./core/main/asg_lambda.zip"
}

resource "aws_lambda_function" "autoscaling_event_update_route53" {
  function_name          = "autoscaling_event_update_route53"

  filename               = "${var.asg_lambda_file}"
  source_code_hash       = "${base64sha256(file("${var.asg_lambda_file}"))}"
  handler                = "asg_lambda.handler"

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

resource "aws_lambda_alias" "asg_event" {
    name                 = "asg_event"
    description          = "Autoscaling event"

    function_name        = "${aws_lambda_function.autoscaling_event_update_route53.arn}"
    function_version     = "$LATEST"
}

resource "aws_lambda_permission" "asg_event" {
    function_name        = "${aws_lambda_function.autoscaling_event_update_route53.arn}"

    statement_id         = "AllowExecutionFromSNS"
    action               = "lambda:InvokeFunction"
    principal            = "sns.amazonaws.com"

    source_arn           = "${aws_sns_topic.instances-access.arn}"
}

resource "aws_sns_topic_subscription" "asg_event" {
    topic_arn            = "${aws_sns_topic.instances-access.arn}"

    protocol             = "lambda"

    endpoint             = "${aws_lambda_function.autoscaling_event_update_route53.arn}"
}
