async function wtQuery(DB, pickDataFrom) {
    const cw_Query = `select 
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
    return cw_Query;
}

module.exports = { wtQuery }