const { get } = require("lodash");
const { getObject } = require("./shared/s3");
const { Headers, Files, getDateTime } = require("./shared/common");
const { Put } = require("./shared/dynamo");
const { v4 } = require("uuid");

let functionName;
module.exports.handler = async (event, context) => {
    functionName = get(context, "functionName");
    const Record = get(event, "Records", []);
    await Promise.all(
        Record.map(async (record) => {
            await processRecord(record);
        })
    );
};

async function processRecord(record) {
    console.log("record: ", record);

    const bucketName = get(record, "s3.bucket.name");
    const key = get(record, "s3.object.key");
    let header;
    if (key === Files.jobConsole) {
        header = Headers.jobConsoleHeader;
    }
    if (key === Files.jobShipment) {
        header = Headers.jobShipmentHeader;
    }
    const file = await getFileFromS3(bucketName, key);
    const data = getObjectFromCsv(file, header);
    await Promise.all(
        data.map(async (row) => {
            let finalRowData = {
                ...row,
                pKey: get(row, "jk_pk", v4()),
                sKey: get(row, "jk_masterbillnum", "000"),
                status: 'PENDING',
                lastUpdatedBy: functionName,
                lastUpdatedTime: getDateTime(),
            };
            await insertRecordIntoDynamoDb(finalRowData);
        })
    );
}

async function getFileFromS3(bucketName, key) {
    const file = await getObject(bucketName, key);
    return file;
}

function getObjectFromCsv(csvString, headers) {
    const rows = csvString.split("\n");

    const results = [];

    for (let i = 1; i < rows.length; i++) {
        const values = rows[i].split(",");
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = values[j].replace(/\s+/g, "");
        }
        results.push(obj);
    }
    return results;
}

async function insertRecordIntoDynamoDb(data) {
    const params = {
        TableName: process.env.EVENT_TABLE,
        Item: data,
    };
    return await Put(params);
}
