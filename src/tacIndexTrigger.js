"use strict";
const AWS = require("aws-sdk");
const batch = new AWS.Batch({ apiVersion: "2016-08-10" });
const STAGE = process.env.STAGE;

module.exports.handler = async (event, context, callback) => {
  try {
    console.info("Event from fullLoadBatchTrigger", event);

    let data = event?.body ? JSON.parse(event.body) : {};

    const params = {
      jobDefinition: "omni-tac-index-job-definition-" + STAGE,
      jobName: "omni-tac-index-" + STAGE,
      jobQueue: "omni-tac-index-job-queue-" + STAGE,
      containerOverrides: {
        environment: [
          {
            name: "isFullLoad",
            value: data?.isFullLoad ?? "false",
          },
          {
            name: "TAC_AUTH_URL",
            value: process.env.TAC_AUTH_URL,
          },
          {
            name: "TAC_FILE_UPLOAD",
            value: process.env.TAC_FILE_UPLOAD,
          },
          {
            name: "TAC_AUTH_USERNAME",
            value: process.env.TAC_AUTH_USERNAME,
          },
          {
            name: "TAC_AUTH_PASSWORD",
            value: process.env.TAC_AUTH_PASSWORD,
          },
          {
            name: "USER",
            value: process.env.USER,
          },
          {
            name: "PASS",
            value: process.env.PASS,
          },
          {
            name: "HOST",
            value: process.env.HOST,
          },
          {
            name: "PORT",
            value: process.env.PORT,
          },
          {
            name: "DBNAME",
            value: process.env.DBNAME,
          },
          {
            name: "REGION",
            value: process.env.REGION,
          },
          {
            name: "STAGE",
            value: process.env.STAGE,
          },
        ],
      },
    };
    console.log("params", params);

    const batchData = await submitBatchJob(params);

    console.info("batchData", batchData);

    const response = {
      statusCode: 200,
      body: JSON.stringify({
        message: `Batch process submitted successfully!`,
      }),
    };

    return callback(null, response);
  } catch (error) {
    console.error("Error while processing data", error);

    const response = {
      statusCode: 400,
      body: JSON.stringify({
        message: `Error while submitting batch process.`,
      }),
    };

    return callback(null, response);
  }
};

async function submitBatchJob(params) {
  return new Promise(async (resolve, reject) => {
    batch.submitJob(params, function (err, data) {
      if (err) {
        console.error(err, err.stack);
        return reject(err);
      } else {
        console.info(data);
        return resolve(data);
      }
    });
  });
}
