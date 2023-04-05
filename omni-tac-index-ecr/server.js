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

let connections = "";
const {
  TAC_AUTH_URL,
  TAC_FILE_UPLOAD,
  TAC_AUTH_USERNAME,
  TAC_AUTH_PASSWORD,
  TAC_LOG_BUCKET,
  isFullLoad = "false",
  USER,
  PASS,
  HOST,
  PORT,
  DBNAME,
  CW_DBNAME
} = process.env;

listBucketJsonFiles();
async function listBucketJsonFiles() {
  try {
    connections = dbc(getConnection());

    const data = await getTacData();
    console.log("DB data", data.length);

    const { csvMawb, filenameMawb } = await createCsvMawb(data);
    await updateDataToTac(csvMawb, filenameMawb, "mawb");

    const { csvHawb, filenameHawb } = await createCsvHawb(data);
    await updateDataToTac(csvHawb, filenameHawb, "hawb");

    connections = dbc(getConnectionToCw());

    const cwData = await getTacDataFromCW();
    console.log("DB data", cwData.length);

    const { csvCwMawb, filenameCwMawb } = await createCwCsvMawb(cwData);
    await updateDataToTac(csvCwMawb, filenameCwMawb, "cwmawb");

    const { csvCwHawb, filenameCwHawb } = await createCwCsvHawb(cwData);
    await updateDataToTac(csvCwHawb, filenameCwHawb, "cwhawb");

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
    //const dbHost = "omni-dw-prod.cnimhrgrtodg.us-east-1.redshift.amazonaws.com";
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

/**
 * Config for connections
 * @param {*} env
 * @returns
 */
function getConnectionToCw() {
  try {
    const dbUser = USER;
    const dbPassword = PASS;
    const dbHost = HOST;
    //const dbHost = "omni-dw-prod.cnimhrgrtodg.us-east-1.redshift.amazonaws.com";
    const dbPort = PORT;
    const dbName = CW_DBNAME;

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
async function getTacDataFromCW() {
  try {

    const query = `select distinct 
    main.mawb,
    --main.FILE_NBR,
    main.js_housebill house_bill_nbr,
    main.origin,
    main.destination,
    main.flight_nbr,
    main.actl_wght,
    case when (case when main.chrg_wght <= 0 then main.actl_wght else main.chrg_wght end ) < main.actl_wght then main.actl_wght else main.chrg_wght   end chrg_wght,
    main.JS_UnitOfWeight,
    '' as Volume,
    '' as "Volume Unit",
    'USD' as Currency,
    '' as "Airline Rate",
    (coalesce(seccst.total_security_cost,0) + coalesce(fuelcst.total_fuel_cost,0) + coalesce(freightcst.total_freight_cost,0)) as "Total Cost To Airline",
    coalesce(seccst.total_security_cost,0) as "Total Security Surcharge",
    coalesce(fuelcst.total_fuel_cost,0) as "Total Fuel Surcharge"
    from 
    (SELECT distinct 
    --c1.al_pk id,
    --c.al_pk as id1,
    jh.jh_pk,jh.jh_gc,
    JK_MasterBillNum mawb,
    js.js_housebill,
    js.JS_UniqueConsignRef AS FILE_NBR,
    jw_rl_nkloadport origin,
    jw_rl_nkdiscport destination,
    jw_voyageflight flight_nbr,
    case when jc.JK_CorrectedConsolWeightUnit = 'KG' then jc.JK_CorrectedConsolWeight else 
    (
    case 
    when JS_UnitOfWeight = 'LB' then js.JS_ActualWeight/2.2046
    when JS_UnitOfWeight = 'LT' then js.JS_ActualWeight/2.68
    when JS_UnitOfWeight = 'MC' then js.JS_ActualWeight*0.0002
    when JS_UnitOfWeight = 'OZ' then js.JS_ActualWeight*0.0283495
    else js.JS_ActualWeight end) end  actl_wght,
    case 
    when js_unitofvolume = 'CF' then js_actualvolume * 4.719474 
    when js_unitofvolume = 'M3' then  js_actualvolume *166.666
    when js_unitofvolume = 'CI' then  js_actualvolume /366.143
    when js_unitofvolume = 'D3' then  (js_actualvolume * 0.001)*166.666
    else js_actualvolume end  chrg_wght,
    --'KG'
    JS_UnitOfWeight
    FROM 
    dbo.jobshipment js 
    join 
    (SELECT X.* FROM 
    (select a.*, 
    ROW_NUMBER() OVER (PARTITION BY A.JH_PARENTID ORDER BY JH_GC)RANK1
    from dbo.jobheader a
    join  (select JH_ParentID,min(jh_systemcreatetimeutc)jh_systemcreatetimeutc from dbo.jobheader group by jh_parentid)b
    on a.JH_ParentID = b.JH_ParentID
    and a.jh_systemcreatetimeutc = b.jh_systemcreatetimeutc
    )X WHERE RANK1 = 1
    )jh
    on js.js_pk = jh.JH_ParentID
    join dbo.glbcompany g
    on jh.jh_gc = g.gc_pk
    join
    DBO.jobconshiplink a
    on a.jn_js = js_pk
    join DBO.jobconsol jc
    on jc.jk_pk = a.jn_jk
    join 
    DBO.JobConsolTransport jct
    on jc.jk_pk = jct.jw_parentguid 
    where 
    JW_TransportMode = 'AIR'
    and cast(js_systemcreatetimeutc as date)  >= '2019-01-01' 
    --and Jk_UniqueConsignRef = 'C00357992'
    --and js.JS_UniqueConsignRef  = 'SLHR00818183'
    --and JK_MasterBillNum  = '69534679083'
    )main
    left outer join 
    (
    select distinct  jr.jr_jh,jr_gc,
    sum(case when 
    g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
    else 
    (case when h.AH_PostDate is null then (JR_LocalCostAmt/PRE.RE_SELLRATE) 
    else ((c.AL_OSAMount)*-1/CASE WHEN POST.RE_SELLRATE IS NULL THEN 1 ELSE POST.RE_SELLRATE END )
    end) end ) over (partition by jr.jr_jh,jr_gc)as total_security_cost
    from
    DBO.JOBSHIPMENT JS 
    left outer JOIN DBO.JOBHEADER JH 
    ON js.JS_PK = jh.JH_ParentID 
    left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK and jr.jr_gc = jh.jh_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK and jr.jr_gc = c.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH and h.ah_gc = c.al_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK and jr.jr_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH and h1.ah_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk and c.al_gc = cc1.ac_gc
    left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk and jh.jh_gc = stn.gb_gc
    join dbo.glbcompany g 
    on jr.jr_gc = g.gc_pk 
    LEFT OUTER JOIN 
    dbo.RefExchangeRate PRE
    ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
    AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
    AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and PRE.re_exratetype = 'BUY'
    LEFT OUTER JOIN 
    dbo.RefExchangeRate POST
    ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
    AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(CAST(h1.AH_InvoiceDate AS DATE),CAST(h.AH_InvoiceDate AS DATE))
    AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and POST.re_exratetype = 'BUY'
    where cc1.AC_Code in ('SEC','SECURSURC','SCC','SEC SERV','ISS')
    and C.AL_LineType in( 'CST' ,'ACR')
    --and js.JS_UniqueConsignRef  = 'SLHR00818183'
    )seccst
    on 
    seccst.JR_JH = main.JH_PK and seccst.jr_gc = main.jh_gc
    left outer join 
    (
    select distinct jr.jr_jh,jr_gc,
    sum(case when 
    g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
    else 
    (case when h.AH_PostDate is null then (JR_LocalCostAmt/PRE.RE_SELLRATE) 
    else ((c.AL_OSAMount)*-1/CASE WHEN POST.RE_SELLRATE IS NULL THEN 1 ELSE POST.RE_SELLRATE END )
    end) end ) over(partition by jr.jr_jh,jr_gc)as total_fuel_cost
    from
    DBO.JOBSHIPMENT JS 
    left outer JOIN DBO.JOBHEADER JH 
    ON js.JS_PK = jh.JH_ParentID 
    left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK and jr.jr_gc = jh.jh_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK and jr.jr_gc = c.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH and h.ah_gc = c.al_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK and jr.jr_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH and h1.ah_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk and c.al_gc = cc1.ac_gc
    left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk and jh.jh_gc = stn.gb_gc
    join dbo.glbcompany g 
    on jr.jr_gc = g.gc_pk 
    LEFT OUTER JOIN 
    dbo.RefExchangeRate PRE
    ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
    AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
    AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and PRE.re_exratetype = 'BUY'
    LEFT OUTER JOIN 
    dbo.RefExchangeRate POST
    ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
    AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(CAST(h1.AH_InvoiceDate AS DATE),CAST(h.AH_InvoiceDate AS DATE))
    AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and POST.re_exratetype = 'BUY'
    where cc1.AC_Code in ('FSC')
    and C.AL_LineType in( 'CST' ,'ACR')
    --and js.JS_UniqueConsignRef  = 'SLHR00818183'
    )fuelcst
    on 
    fuelcst.JR_JH = main.JH_PK and fuelcst.jr_gc = main.jh_gc
    left outer join 
    (
    select distinct jr.jr_jh,jr_gc,
    sum(case when 
    g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
    else 
    (case when h.AH_PostDate is null then (JR_LocalCostAmt/PRE.RE_SELLRATE) 
    else ((c.AL_OSAMount)*-1/CASE WHEN POST.RE_SELLRATE IS NULL THEN 1 ELSE POST.RE_SELLRATE END )
    end) end ) over(partition by jr.jr_jh,jr_gc)as total_freight_cost
    from
    DBO.JOBSHIPMENT JS 
    left outer JOIN DBO.JOBHEADER JH 
    ON js.JS_PK = jh.JH_ParentID 
    left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK and jr.jr_gc = jh.jh_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK and jr.jr_gc = c.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH and h.ah_gc = c.al_gc
    LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK and jr.jr_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH and h1.ah_gc = c1.al_gc
    LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk and c.al_gc = cc1.ac_gc
    left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk and jh.jh_gc = stn.gb_gc
    join dbo.glbcompany g 
    on jr.jr_gc = g.gc_pk 
    LEFT OUTER JOIN 
    dbo.RefExchangeRate PRE
    ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
    AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
    AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and PRE.re_exratetype = 'BUY'
    LEFT OUTER JOIN 
    dbo.RefExchangeRate POST
    ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
    AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(CAST(h1.AH_InvoiceDate AS DATE),CAST(h.AH_InvoiceDate AS DATE))
    AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
    and POST.re_exratetype = 'BUY'
    where cc1.AC_Code in ('FREIGHTER','FRT','FRT2','INTL AIR','AIRFRT')
    and C.AL_LineType in( 'CST' ,'ACR')
    --and js.JS_UniqueConsignRef  = 'SLHR00818183'
    )freightcst
    on 
    freightcst.JR_JH = main.JH_PK and freightcst.jr_gc = main.jh_gc
    `;
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
      "HAWB Number": e["house_bill_nbr"],
      "MAWB Number": e["mawb"],
      Date: moment(e["date"]).format("YYYY-MM-DD"),
      Origin: e["origin"],
      Destination: e["destination"],
      "Flight Number": e["flight_nbr"],
      "Actual Weight": e["actl_wght"],
      "Chargeable Weight": e["chrg_wght"],
      "Weight Unit": e["js_unitofweight"],
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
      mawb: e["mawb"],
      date: moment(e["date"]).format("YYYY-MM-DD"),
      origin: e["origin"],
      destination: e["destination"],
      "flight number": e["flight_nbr"],
      "actual weight": e["actl_wght"],
      "chargeable weight": e["chrg_wght"],
      "weight unit": e["js_unitofweight"],
      volume: e["volume"],
      "volume unit": e["volume unit"],
      currency: e["currency"],
      airline_rate: e["airline rate"],
      "total cost to airline": e["total cost to airline"],
      "total fuel surcharge": e["total fuel surcharge"],
      "total security surcharge": e["total security surcharge"],
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
