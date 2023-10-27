resource "aws_ssm_parameter" "omni_tac_event_bucket_name" {
  name  = "/omni-tac-index/${var.env}/event-processor/bucket-name"
  type  = "String"
  value = var.omni_tac_event_bucket_name

  tags = {
    Application = "Omni Tac Index"
    CreatedBy   = "BizCloudExperts"
    Environment = var.env
    STAGE       = var.env
  }
}

resource "aws_ssm_parameter" "omni_tac_event_table_stream_arn" {
  name  = "/omni-tac-index/${var.env}/event-table-stream-arn"
  type  = "String"
  value = aws_dynamodb_table.omni_tac_event_table.stream_arn
 
  tags = {
    Application = "Omni Tac Index"
    CreatedBy   = "BizCloudExperts"
    Environment = var.env
    STAGE       = var.env
  }
}

resource "aws_ssm_parameter" "omni_tac_hawb_output_serializer_fifo_queue_url" {
  name        = "/omni-tac-index/${var.env}/hawb-output-serializer-fifo-queue-url"
  description = "URL of the hawb output serializer fifo queue"
  type        = "String"
  value       = aws_sqs_queue.omni_tac_hawb_output_serializer_fifo_queue.url
}