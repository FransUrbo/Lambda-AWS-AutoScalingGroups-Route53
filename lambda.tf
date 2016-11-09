# https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
variable "asg_lambda_file" {
  description            = "File to use for the ASG Lambda function"
  default                = "./asg_lambda.zip"
}

resource "aws_lambda_function" "autoscaling_event" {
  function_name          = "autoscaling_event"

  filename               = "${var.asg_lambda_file}"
  source_code_hash       = "${base64sha256(file("${var.asg_lambda_file}"))}"
  handler                = "asg_lambda.handler"

  runtime                = "nodejs"
  memory_size            = 128
  timeout                = 10

  role                   = "${aws_iam_role.ASGNotify.arn}"
}

resource "aws_lambda_alias" "asg_event" {
    name                 = "asg_event"
    description          = "Autoscaling event"

    function_name        = "${aws_lambda_function.autoscaling_event.arn}"
    function_version     = "$LATEST"
}

resource "aws_lambda_permission" "asg_event" {
    function_name        = "${aws_lambda_function.autoscaling_event.arn}"

    statement_id         = "AllowExecutionFromSNS"
    action               = "lambda:InvokeFunction"
    principal            = "sns.amazonaws.com"

    source_arn           = "${aws_sns_topic.instances-access.arn}"
}

resource "aws_sns_topic_subscription" "asg_event" {
    topic_arn            = "${aws_sns_topic.instances-access.arn}"

    protocol             = "lambda"

    endpoint             = "${aws_lambda_function.main_autoscaling_event.arn}"
}
