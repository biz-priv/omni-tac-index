async function cwQuery() {
    const cw_Query = `select distinct 
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
    return cw_Query;
}
module.exports = { cwQuery }