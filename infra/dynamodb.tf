resource "aws_dynamodb_table" "omni_tac_event_table" {
  name             = "omni-tac-event-table-${var.env}"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pKey"
  range_key        = "sKey"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pKey"
    type = "S"
  }

  attribute {
    name = "sKey"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name               = "status-index"
    hash_key           = "status"
    range_key          = "sKey"
    projection_type    = "ALL"
  }

  tags = {
    Application = "Omni Tac Index"
    CreatedBy   = "BizCloudExperts"
    Environment = var.env
    STAGE       = var.env
  }
}

resource "aws_dynamodb_table" "omni_tac_output_status_table" {
  name             = "omni-tac-output-status-table-${var.env}"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pKey"
  range_key        = "sKey"

  attribute {
    name = "pKey"
    type = "S"
  }

  attribute {
    name = "sKey"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name               = "status-index"
    hash_key           = "status"
    range_key          = "sKey"
    projection_type    = "ALL"
  }

  tags = {
    Application = "Omni Tac Index"
    CreatedBy   = "BizCloudExperts"
    Environment = var.env
    STAGE       = var.env
  }
}
