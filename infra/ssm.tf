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
