# resource "aws_ssm_parameter" "shipment-header-arn" {
#   name  = "/omni-wt-rt-updates/${var.env}/shipment-header/ddb.arn"
#   type  = "SecureString"
#   value = aws_dynamodb_table.omni-wt-rt-shipment-header.arn

#   tags = {
#     Application = "Real Time Updates"
#     CreatedBy   = "BizCloudExperts"
#     Environment = var.env
#     STAGE       = var.env
#   }
# }
