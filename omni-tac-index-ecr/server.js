/*
* File: omni-tac-index-ecr\server.js
* Project: Omni-tac-index
* Author: Bizcloud Experts
* Date: 2023-05-26
* Confidential and Proprietary
*/
"use strict";
const AWS = require("aws-sdk");
const axios = require("axios");
const pgp = require("pg-promise");
const dbc = pgp({ capSQL: true });
const moment = require("moment");
const { parse } = require("json2csv");
var FormData = require("form-data");
AWS.config.update({ region: process.env.REGION });
const S3 = new AWS.S3();
const { getConnection } = require("./shared/index")
const { cwQuery } = require("./shared/query/cw_Query")
const { wtQuery } = require("./shared/query/wt_Query")

let connections = "";
const {
  TAC_AUTH_URL,
  TAC_FILE_UPLOAD,
  TAC_AUTH_USERNAME,
  TAC_AUTH_PASSWORD,
  TAC_LOG_BUCKET,
  isFullLoad = "false",
  DBNAME,
  CW_DBNAME
} = process.env;

listBucketJsonFiles();
async function listBucketJsonFiles() {
  try {
    const wt_dbName = DBNAME;
    connections = dbc(getConnection(wt_dbName));

    const data = await getTacData();
    console.log("DB data", data.length);

    const { csvMawb, filenameMawb } = await createCsvMawb(data);
    await updateDataToTac(csvMawb, filenameMawb, "mawb");

    const { csvHawb, filenameHawb } = await createCsvHawb(data);
    await updateDataToTac(csvHawb, filenameHawb, "hawb");

    const cw_dbName = CW_DBNAME;
    connections = dbc(getConnection(cw_dbName));

    const cwData = await getTacDataFromCW();
    console.log("DB data", cwData.length);

    const { csvCwMawb, filenameCwMawb } = await createCwCsvMawb(cwData);
    await updateDataToTac(csvCwMawb, filenameCwMawb, "cwmawb");

    // const { csvCwHawb, filenameCwHawb } = await createCwCsvHawb(cwData);
    // await updateDataToTac(csvCwHawb, filenameCwHawb, "cwhawb");

    return true;
  } catch (error) {
    console.error("Error while processing data", error);
    return false;
  }
}


/**
 * fetch tac data from redshift
 * @returns tac data
 */
async function getTacData() {
  try {
    const DB = process.env.STAGE === "dev" ? "dbo." : "dbc.";
    const pickDataFrom =
      isFullLoad === "true" ? " 2019-01-01 " : " current_date - 45 ";

    const query = await wtQuery(DB, pickDataFrom)
    console.log("query", query);
    const result = await connections.query(query);
    if (!result || result.length == 0) {
      throw "No data found.";
    }
    return result;
  } catch (error) {
    console.log("error", error);
    throw "No data found.";
  }
}

/**
 * create Hawb csv
 * Only upload HAWB data that has an associated MAWB.
 * @param {*} data
 * @returns
 */
async function createCsvHawb(data) {
  const fieldsHawb = [
    "HAWB Number", //req hawb
    "MAWB Number", //req mawb
    "Date", //req date
    "Origin", //req origin
    "Destination", //req destination
    "Flight Number", //req flight number
    "Actual Weight", //req actual weight
    "Chargeable Weight", //req chargeable weight
    "Weight Unit", //req weight unit
    "Volume", // volume
    "Volume Unit", // volume unit
  ];
  const optsHawb = { fieldsHawb };
  const formatedHawb = data
    .filter((e) => e.mawb.length > 0)
    .map((e) => ({
      "HAWB Number": e["hawb"],
      "MAWB Number": e["mawb"],
      Date: moment(e["date"]).format("YYYY-MM-DD"),
      Origin: e["origin"],
      Destination: e["destination"],
      "Flight Number": e["flight number"],
      "Actual Weight": e["actual weight"],
      "Chargeable Weight": e["chargeable weight"],
      "Weight Unit": e["weight unit"],
      Volume: e["volume"],
      "Volume Unit": e["volume unit"],
    }));
  const csvHawb = parse(formatedHawb, optsHawb);
  const filename = `hawb-${moment().format("YYYY-MM-DD")}.csv`;
  return { csvHawb, filenameHawb: filename };
}

/**
 * create Mawb csv
 * @param {*} data
 * @returns
 */
async function createCsvMawb(data) {
  const fieldsMawb = [
    "MAWB Number", //req mawb
    "Date", //req date
    "Origin", //req origin
    "Destination", //req destination
    "Flight Number", //req flight number
    "Actual Weight", //req actual weight
    "Chargeable Weight", //req chargeable weight
    "Weight Unit", //req weight unit
    "Volume", // volume
    "Volume Unit", // volume unit
    "Currency", //req currency
    "Airlines Rate", // airline_rate
    "Total Cost to Carrier", //req total cost to airline
    "Total Fuel Surcharge", // total fuel surcharge
    "Total Security Surcharge", // total security surcharge
  ];
  const optsMawb = { fieldsMawb };
  const formatedMawb = data
    .filter((e) => e.mawb.length > 0)
    .map((e) => ({
      mawb: e["mawb"],
      date: moment(e["date"]).format("YYYY-MM-DD"),
      origin: e["origin"],
      destination: e["destination"],
      "flight number": e["flight number"],
      "actual weight": e["actual weight"],
      "chargeable weight": e["chargeable weight"],
      "weight unit": e["weight unit"],
      volume: e["volume"],
      "volume unit": e["volume unit"],
      currency: e["currency"],
      airline_rate: e["airline_rate"],
      "total cost to airline": e["total cost to airline"],
      "total fuel surcharge": e["total fuel surcharge"],
      "total security surcharge": e["total security surcharge"],
    }));
  const csvMawb = parse(formatedMawb, optsMawb);
  const filename = `mawb-${moment().format("YYYY-MM-DD")}.csv`;
  return { csvMawb, filenameMawb: filename };
}


/**
 * fetch tac data from redshift
 * @returns tac data
 */
async function getTacDataFromCW() {
  try {
    const pickDataFrom =
      isFullLoad === "true" ? " 2018-01-01 " : " current_date - 45 ";
    const query = await cwQuery(pickDataFrom);
    console.log("query", query);
    const result = await connections.query(query);
    if (!result || result.length == 0) {
      throw "No data found.";
    }
    return result;
  } catch (error) {
    console.log("error", error);
    throw "No data found.";
  }
}

/**
 * create Hawb csv
 * Only upload HAWB data that has an associated MAWB.
 * @param {*} cwData
 * @returns
 */
async function createCwCsvHawb(cwData) {
  const fieldsHawb = [
    "HAWB Number", //req hawb
    "MAWB Number", //req mawb
    "Date", //req date
    "Origin", //req origin
    "Destination", //req destination
    "Flight Number", //req flight number
    "Actual Weight", //req actual weight
    "Chargeable Weight", //req chargeable weight
    "Weight Unit", //req weight unit
    "Volume", // volume
    "Volume Unit", // volume unit
  ];
  const optsHawb = { fieldsHawb };
  const formatedHawb = cwData
    .filter((e) => e.mawb.length > 0)
    .map((e) => ({
      "HAWB Number": e["hawb"],
      "MAWB Number": e["mawb"],
      Date: moment(e["date"]).format("YYYY-MM-DD"),
      Origin: e["origin"],
      Destination: e["destination"],
      "Flight Number": e["flight number"],
      "Actual Weight": e["actual weight"],
      "Chargeable Weight": e["chargeable weight"],
      "Weight Unit": e["weight unit"],
      Volume: e["volume"],
      "Volume Unit": e["volume unit"],
    }));
  const csvCwHawb = parse(formatedHawb, optsHawb);
  const filename = `cwhawb-${moment().format("YYYY-MM-DD")}.csv`;
  return { csvCwHawb, filenameCwHawb: filename };
}

/**
 * create Mawb csv
 * @param {*} cwData
 * @returns
 */
async function createCwCsvMawb(cwData) {
  const fieldsMawb = [
    "MAWB Number", //req mawb
    "Date", //req date
    "Origin", //req origin
    "Destination", //req destination
    "Flight Number", //req flight number
    "Actual Weight", //req actual weight
    "Chargeable Weight", //req chargeable weight
    "Weight Unit", //req weight unit
    "Volume", // volume
    "Volume Unit", // volume unit
    "Currency", //req currency
    "Airlines Rate", // airline_rate
    "Total Cost to Carrier", //req total cost to airline
    "Total Fuel Surcharge", // total fuel surcharge
    "Total Security Surcharge", // total security surcharge
  ];
  const optsMawb = { fieldsMawb };
  const formatedMawb = cwData
    .filter((e) => e.mawb.length > 0)
    .map((e) => ({
      "MAWB Number": e["mawb"],
      Date: moment(e["date"]).format("YYYY-MM-DD"),
      Origin: e["origin"],
      Destination: e["destination"],
      "Flight Number": e["flight number"],
      "Actual Weight": e["actual weight"],
      "Chargeable Weight": e["chargeable weight"],
      "Weight Unit": e["weight unit"],
      Volume: e["volume"],
      "Volume Unit": e["volume unit"],
      Currency: e["currency"],
      "Airlines Rate": e["airlines rate"],
      "Total Cost to Carrier": e["total cost to carrier"],
      "Total Fuel Surcharge": e["total fuel surcharge"],
      "Total Security Surcharge": e["total security surcharge"],
    }));
  const csvCwMawb = parse(formatedMawb, optsMawb);
  const filename = `cwmawb-${moment().format("YYYY-MM-DD")}.csv`;
  return { csvCwMawb, filenameCwMawb: filename };
}


function tacAuth() {
  return new Promise(async (resolve, reject) => {
    try {
      axios({
        method: "get",
        maxBodyLength: Infinity,
        url: TAC_AUTH_URL,
        auth: {
          username: TAC_AUTH_USERNAME,
          password: TAC_AUTH_PASSWORD,
        },
      })
        .then(function (response) {
          console.log(JSON.stringify(response.data));
          resolve(response.data);
        })
        .catch(function (error) {
          console.log(error);
          reject(error);
        });
    } catch (error) {
      console.log("tacAuth:error", error);
      reject(error);
    }
  });
}

function updateDataToTac(csvData, filename, type) {
  return new Promise(async (resolve, reject) => {
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

      axios(config)
        .then(async (response) => {
          console.log(JSON.stringify(response.data));
          await uploadFileToS3(csvData, filename, type);
          resolve(response.data);
        })
        .catch(function (error) {
          console.log(error);
          reject(error);
        });
    } catch (error) {
      console.log("error", error);
      reject(error);
    }
  });
}

async function uploadFileToS3(csvData, filename, type = "other") {
  try {
    const params = {
      Bucket: TAC_LOG_BUCKET + "/" + type,
      Key: filename,
      Body: csvData,
      ContentType: "application/octet-stream",
    };
    await S3.putObject(params).promise();
  } catch (error) {
    console.log("error", error);
  }
}
