"use strict";
const AWS = require("aws-sdk");
const axios = require("axios");
const pgp = require("pg-promise");
const dbc = pgp({ capSQL: true });
const moment = require("moment");
const { parse } = require("json2csv");
var FormData = require("form-data");
AWS.config.update({ region: process.env.REGION });

let connections = "";
const {
  TAC_AUTH_URL,
  TAC_FILE_UPLOAD,
  TAC_AUTH_USERNAME,
  TAC_AUTH_PASSWORD,
  isFullLoad = "false",
  USER,
  PASS,
  HOST,
  PORT,
  DBNAME,
} = process.env;

listBucketJsonFiles();
async function listBucketJsonFiles() {
  try {
    connections = dbc(getConnection());

    const data = await getTacData();
    console.log("DB data", data.length);

    const { csvMawb, filenameMawb } = await createCsvMawb(data);
    await updateDataToTac(csvMawb, filenameMawb);

    const { csvHawb, filenameHawb } = await createCsvHawb(data);
    await updateDataToTac(csvHawb, filenameHawb);

    return true;
  } catch (error) {
    console.error("Error while processing data", error);
    return false;
  }
}

/**
 * Config for connections
 * @param {*} env
 * @returns
 */
function getConnection() {
  try {
    const dbUser = USER;
    const dbPassword = PASS;
    const dbHost = HOST;
    // const dbHost = "omni-dw-prod.cnimhrgrtodg.us-east-1.redshift.amazonaws.com";
    const dbPort = PORT;
    const dbName = DBNAME;

    const connectionString = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
    console.log("connectionString", connectionString);
    return connectionString;
  } catch (error) {
    throw "DB Connection Error";
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

    const query = `select 
        MAWB,
        housebill as "HAWB",
        CAST("Date" AS DATE) "Date",
        Origin,
        Destination,
        "Flight Number",
        "Actual Weight",
          case when "Chargeable Weight" < "Actual Weight" then "Actual Weight" else "Chargeable Weight" end  as "Chargeable Weight" ,
          "Weight Unit" ,
          Volume,
          "Volume Unit",
          Currency,
          Airline_Rate,
          "Total Cost to Airline",
          "Total Fuel Surcharge",
          "Total Security Surcharge"
          from 
        (select distinct 
          a.fk_orderno as "file_nbr",
          e.housebill,
          c.refno as "MAWB",
          a.flightdatetime1 as "Date",
          a.orgairport as Origin,
          a.destairport as Destination,
          a.flightno1 as "Flight Number",
          coalesce(d.actualweight ,detl.WEIGHTLBS)as "Actual Weight",
          coalesce(case when d.ChargeableWeight  <= 0 then 
          case 
            when d."Weight Unit"  = 'L' then 
            (case when detl.WEIGHTLBS > detl.DIMWEIGHTLBS  then detl.WEIGHTLBS else detl.DIMWEIGHTLBS   end)
            else
            (case when detl.WEIGHTKGS > detl.DIMWEIGHTKGS then detl.WEIGHTKGS else detl.DIMWEIGHTKGS end) end 
          else d.ChargeableWeight end ,
          case when detl.WEIGHTLBS > detl.DIMWEIGHTLBS  then detl.WEIGHTLBS else detl.DIMWEIGHTLBS end )as "Chargeable Weight",
          d."Weight Unit" as "Weight Unit" ,
          '' Volume,
          '' "Volume Unit",
          a.fk_currency as Currency,
          c.rate as Airline_Rate,
          case when d.total > 0 then d.total else c.total end "Total Cost to Airline",
          '' as "Total Fuel Surcharge",
          '' as "Total Security Surcharge"
          from ${DB}tbl_airwaybill a
          join 
          (select fk_orderno,max(fk_seqno) as fk_seqno from ${DB}tbl_airwaybill group by fk_orderno) as b
          on a.fk_orderno = b.fk_orderno
          and a.fk_seqno = b.fk_seqno
          join ${DB}tbl_shipmentapar c
          on a.fk_orderno = c.fk_orderno
          and a.fk_seqno = c.seqno
          left outer join 
          (select distinct
          fk_airwaybillno,
          sum(pieces) over(partition by fk_airwaybillno) as pieces,
          sum(grossweight)over(partition by fk_airwaybillno) as actualweight,
          sum(chargeableweight) over(partition by fk_airwaybillno) as ChargeableWeight,
          sum(total)over(partition by fk_airwaybillno) as total,
          LB_KG as "Weight Unit"
        from ${DB}tbl_airwaybilldesc 
        where lb_kg <>''
          ) as d
          on a.pk_airwaybillno = d.fk_airwaybillno
        left outer join ${DB}tbl_shipmentheader e
        on a.fk_orderno = e.pk_orderno
        LEFT OUTER JOIN
        (SELECT
        fk_orderno, SUM(weight) as WEIGHTLBS,SUM(weightkilo) as WEIGHTKGS,
        SUM(dimweight)AS DIMWEIGHTLBS,
        SUM(dimweightkilo)AS DIMWEIGHTKGS
        FROM ${DB}tbl_shipmentdesc detl
        GROUP BY fk_orderno  
        ) as detl
        ON e.pk_orderno = detl.fk_orderno 
          where cast(flightdatetime1 as date) >= ${pickDataFrom}
          AND LENGTH(c.refno) = 11
          AND c.refno SIMILAR TO '[0-9]{11}'
        )main
        order by "Date"`;
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

function updateDataToTac(csvData, filename) {
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
        .then(function (response) {
          console.log(JSON.stringify(response.data));
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
