"use strict";
const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const { get } = require("lodash");
const moment = require("moment");
const { TAC_AUTH_URL, TAC_FILE_UPLOAD, TAC_AUTH_USERNAME, TAC_AUTH_PASSWORD } =
	process.env;

let functionName;
module.exports.handler = async (event, context) => {
	try {
		console.log("event:", JSON.stringify(event));
		functionName = get(context, "functionName");

		const record = get(event, "Records[0]", {});
		const eventName = get(record, "eventName");
		if (!["INSERT", "MODIFY"].includes(eventName))
			//Proceed further only for INSERT and MODIFY
			return `Only allowed events are ${["INSERT", "MODIFY"]}`;

		let keys = getRowData({ objectData: get(record, "dynamodb.Keys") });
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:15 ~ module.exports.handler= ~ keys:",
			keys
		);

		const newImage = get(record, "dynamodb.NewImage");
		const data = getRowData({ objectData: newImage }); //Convert the data into a simple object
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:22 ~ module.exports.handler= ~ data:",
			data
		);

		const status = get(data, "status", "");
		if (!["PENDING", "RETRY"].includes(status))
			//Proceed further only for PENDING and RETRY
			return `Exiting as status is: ${status}`;

		const existingObject = await s3GetObject({
			//Get the existing file if any.
			fileName: `${moment().format("MMDDYYYY")}.csv`,
		});

		let csvToUpload;
		if (!existingObject)
			csvToUpload = createCSV({ data: [data], forExisting: false });

		if (existingObject)
			csvToUpload =
				existingObject + "\n" + createCSV({ data: [data], forExisting: true });
		await s3PutObject({ data: csvToUpload });
		const isLastRow = get(data, "lastRow", "false").toLocaleUpperCase();
		if (isLastRow === "TRUE") await updateDataToTac({ finalCsv: csvToUpload });
		await updateDynamo({ keys, status: "SUCCESS" });
		return `Record processed successfully.`;
	} catch (error) {
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:41 ~ module.exports.handler= ~ error:",
			error
		);
		await updateDynamo({ keys, status: "FAILED" });
		throw e;
	}
};

/**
 * Extracts key-value pairs from the provided objectData and constructs a new object.
 *
 * @param {Object} objectData - The input object containing key-value pairs.
 * @returns {Object} - A new object with simplified key-value pairs extracted from objectData.
 * @throws Will throw an error if objectData is not a valid object.
 * @example
 * const inputObject = {
 *   a: { value: 1 },
 *   b: { data: 'example' },
 *   c: { content: true }
 * };
 * const simplifiedObject = getRowData({ objectData: inputObject });
 * // Output: { a: 1, b: 'example', c: true }
 */
function getRowData({ objectData }) {
	const finalData = {};
	for (const key in objectData) {
		if (Object.hasOwn(objectData, key)) {
			const element = objectData[key];
			finalData[key] = Object.values(element)[0];
		}
	}
	return finalData;
}

/**
 * Uploads data to the specified S3 bucket with a dynamically generated filename.
 *
 * @param {Object} params - Parameters for uploading data to S3.
 * @param {string} params.data - The data to be uploaded to S3 (e.g., CSV content).
 * @returns {Promise<void>} - A Promise that resolves when the data is successfully uploaded to S3.
 * @throws Will throw an error if the S3 putObject operation fails.
 * @example
 * try {
 *   await s3PutObject({ data: 'csv data here' });
 *   console.log('Data successfully uploaded to S3.');
 * } catch (error) {
 *   console.error('Failed to upload data to S3:', error.message);
 * }
 */
async function s3PutObject({ data }) {
	try {
		const params = {
			Bucket: "omni-tac-hawb-output-files-temp",
			Key: `${moment().format("MMDDYYYY")}.csv`,
			Body: data,
		};
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:67 ~ s3PutObject ~ params:",
			params
		);
		const res = await s3.putObject(params).promise();
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:67 ~ s3PutObject ~ res:",
			res
		);
	} catch (e) {
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:68 ~ s3PutObject ~ e:",
			e
		);
		throw e;
	}
}

/**
 * Retrieves the content of an object from the specified S3 bucket.
 *
 * @param {Object} params - Parameters for retrieving the S3 object.
 * @param {string} params.fileName - The name of the file to be retrieved from the S3 bucket.
 * @returns {Promise<string|boolean>} - A Promise that resolves to the content of the retrieved file as a string,
 *                                      or `false` if the retrieval fails.
 * @throws Will throw an error if the S3 getObject operation fails.
 * @example
 * const fileContent = await s3GetObject({ fileName: 'example.txt' });
 * if (fileContent) {
 *   console.log('File content:', fileContent);
 * } else {
 *   console.error('Failed to retrieve file from S3.');
 * }
 */
async function s3GetObject({ fileName }) {
	try {
		const params = {
			Bucket: "omni-tac-hawb-output-files-temp",
			Key: fileName,
		};
		const response = await s3.getObject(params).promise();
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:88 ~ s3GetObject ~ response:",
			get(response, "Body", "").toString()
		);
		return get(response, "Body", "").toString();
	} catch (e) {
		// Handle the error, optionally log it for debugging purposes
		console.error(`Error retrieving file from S3: ${e.message}`);
		//* Do not throw error. File may not be available in S3.
		return false;
	}
}

/**
 * Creates a CSV string from the provided data array.
 *
 * @param {Object[]} data - An array of objects containing data to be converted to CSV.
 * @param {boolean} [forExisting=false] - If true, returns CSV data only without headers.
 * @returns {string} - A CSV formatted string.
 * @throws Will throw an error if data is not an array of objects or if object properties are not uniform.
 * @example
 * const inputArray = [
 *   { name: 'Alice', age: 30, city: 'New York' },
 *   { name: 'Bob', age: 25, city: 'Los Angeles' }
 * ];
 * const csvData = createCSV({ data: inputArray });
 * // Output: "name,age,city\nAlice,30,\"New York\"\nBob,25,\"Los Angeles\""
 */
function createCSV({ data = {}, forExisting = false }) {
	try {
		validateData(data);
		const keys = Object.keys(data[0]);
		const header = keys.join(",");
		const values = data.map((row) => {
			const rowValues = [];
			for (const key of keys) {
				const value = row[key].includes(",") ? `"${row[key]}"` : row[key];
				rowValues.push(value);
			}
			return rowValues.join(",");
		});
		return forExisting ? values.join("\n") : [header, ...values].join("\n");
	} catch (error) {
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:157 ~ createCSV ~ error:",
			error
		);
		throw error;
	}
}

/**
 * Validates if the provided value is a valid array of objects.
 *
 * @param {any} value - The value to be validated.
 * @returns {boolean} - True if the value is a valid array of objects, false otherwise.
 * @throws Will throw an error if the value is not a valid array of objects.
 * @private
 */
function validateData(value) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every((obj) => typeof obj === "object")
	) {
		throw new Error("Invalid input data. Expected an array of objects.");
	}
	const keys = Object.keys(value[0]);
	if (
		!value.every(
			(obj) =>
				Object.keys(obj).length === keys.length &&
				Object.keys(obj).every((key) => keys.includes(key))
		)
	) {
		throw new Error("Invalid input data. Object properties are not uniform.");
	}
	return true;
}

async function updateDynamo({ keys, status }) {
	try {
		const params = {
			TableName: "omni-tac-hawb-output-table-temp",
			Key: {
				...keys,
			},
			UpdateExpression:
				"SET #status = :status, #lastUpdatedBy = :lastUpdatedBy, #lastUpdatedOn = :lastUpdatedOn",
			ExpressionAttributeNames: {
				"#status": "status",
				"#lastUpdatedBy": "lastUpdatedBy",
				"#lastUpdatedOn": "lastUpdatedOn",
			},
			ExpressionAttributeValues: {
				":status": status,
				":lastUpdatedBy": functionName,
				":lastUpdatedOn": moment().format("YYYY-MM-DD HH:mm:ss"),
			},
			ReturnValues: "UPDATED_NEW",
		};
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:112 ~ updateDynamo ~ params:",
			params
		);
		const res = await dynamodb.update(params).promise();
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:119 ~ updateDynamo ~ res:",
			res
		);
	} catch (e) {
		console.log(
			"🚀 ~ file: tacHAWBOutputFileHandler.js:120 ~ updateDynamo ~ e:",
			e
		);
		throw e;
	}
}

async function tacAuth() {
	try {
		const response = await axios({
			method: "get",
			maxBodyLength: Infinity,
			url: TAC_AUTH_URL,
			auth: {
				username: TAC_AUTH_USERNAME,
				password: TAC_AUTH_PASSWORD,
			},
		});
		return get(response, "data");
	} catch (error) {
		console.log("tacAuth:error", error);
		throw error;
	}
}

async function updateDataToTac(csvData, filename, type) {
	try {
		if (process.env.STAGE.toLowerCase() === "dev") {
			await tacAuth();
		}
		let data = new FormData();
		data.append("file1", csvData, filename);
		const config = {
			method: "post",
			maxBodyLength: Infinity,
			url: TAC_FILE_UPLOAD,
			headers: {
				...data.getHeaders(),
				"Content-length": data.getLengthSync(),
				"Content-Type": "text/csv",
			},
			auth: {
				username: TAC_AUTH_USERNAME,
				password: TAC_AUTH_PASSWORD,
			},
			data: data,
		};

		const response = await axios(config);
		return get(response, "data");
	} catch (error) {
		console.log("error", error);
		throw error;
	}
}
