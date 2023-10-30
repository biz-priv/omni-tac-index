const { get } = require("lodash");
const { getObject } = require("./shared/s3");
const { Headers, Files } = require("./shared/common");
module.exports.handler = async (event, context) => {
    console.log(
        `🙂 -> file: tacEventProcessor.js:3 -> context:`,
        JSON.stringify(context)
    );
    console.log(
        `🙂 -> file: tacEventProcessor.js:3 -> event:`,
        JSON.stringify(event)
    );
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
    console.log(
        `🙂 -> file: tacEventProcessor.js:22 -> bucketName:`,
        bucketName
    );

    const key = get(record, "s3.object.key");
    console.log(`🙂 -> file: tacEventProcessor.js:24 -> key:`, key);

    let header;
    if (key === Files.jobConsole) {
        header = Headers.jobConsoleHeader;
    }
    if (key === Files.jobShipment) {
        header = Headers.jobShipmentHeader;
    }
    const file = await getFileFromS3(bucketName, key);
    console.log(`🙂 -> file: tacEventProcessor.js:33 -> file:`, file);
    const data = getObjectFromCsv(file, header);
    console.log(`🙂 -> file: tacEventProcessor.js:35 -> data:`, data);
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
            obj[headers[j]] = values[j];
        }
        results.push(obj);
    }
    return results;
}
