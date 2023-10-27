resource "aws_sqs_queue" "omni_tac_hawb_output_serializer_fifo_queue" {
    name                        = "omni-tac-hawb-output-serializer-fifo-queue-${var.env}.fifo" # Specify the name of your FIFO queue
    fifo_queue                  = true
    content_based_deduplication = true

    # Specify the SQS queue attributes
    redrive_policy = jsonencode({
        deadLetterTargetArn = aws_sqs_queue.omni_tac_hawb_output_serializer_dead_letter_queue.arn
        maxReceiveCount     = 5 # Number of times a message can be received from the queue before being moved to the dead letter queue
    })
}

resource "aws_sqs_queue" "omni_tac_hawb_output_serializer_dead_letter_queue" {
    name = "omni-tac-hawb-output-serialize-dead-letter-queue-${var.env}.fifo" # Specify the name of your dead letter queue
    fifo_queue = true
}