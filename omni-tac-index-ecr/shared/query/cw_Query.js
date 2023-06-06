async function cwQuery(date) {
    const cw_Query = `select
    distinct main.mawb,
    cast(atd.atd as date) as "Date",
    main.origin,
    main.destination,
    mawb.flt AS "flight number",
    main.actual_wght AS "actual weight",
    main.chrg_wght AS "chargeable weight",
    main.weight_unit AS "weight unit",
    main.Volume,
    main.Volume_Unit as "Volume Unit",
    'USD' as Currency,
    Coalesce(seccst.total_security_cost, 0) as "Total Security Surcharge",
    Coalesce(fuelcst.total_fuel_cost, 0) as "Total Fuel Surcharge",
    Coalesce(freightcst.total_freight_cost, 0) as "Airlines Rate",
    Coalesce(seccst.total_security_cost, 0) + Coalesce(fuelcst.total_fuel_cost, 0) + Coalesce(freightcst.total_freight_cost, 0) AS "Total Cost to Carrier"
 from
    (
        SELECT
            DISTINCT jk_masterbillnum mawb,
            jk_rl_nkloadport origin,
            jk_rl_nkdischargeport destination,
            sum(
                cast(
                    case
                        when JS_UnitOfWeight = 'KG' then JS_ActualWeight
                        when JS_UnitOfWeight = 'LB' then JS_ActualWeight * 0.453592
                    end as numeric(15, 2)
                )
            ) over (
                partition by jk_masterbillnum,
                jk_rl_nkloadport,
                jk_rl_nkdischargeport
            ) As actual_wght,
            sum(
                cast(
                    case
                        when (
                            case
                                when JS_UnitOfWeight = 'KG' then JS_ActualChargeable
                                when JS_UnitOfWeight = 'LB' then JS_ActualChargeable * 0.453592
                            end
                        ) < (
                            case
                                when JS_UnitOfWeight = 'KG' then JS_ActualWeight
                                when JS_UnitOfWeight = 'LB' then JS_ActualWeight * 0.453592
                            end
                        ) then (
                            case
                                when JS_UnitOfWeight = 'KG' then JS_ActualWeight
                                when JS_UnitOfWeight = 'LB' then JS_ActualWeight * 0.453592
                            end
                        )
                        else (
                            case
                                when JS_UnitOfWeight = 'KG' then JS_ActualChargeable
                                when JS_UnitOfWeight = 'LB' then JS_ActualChargeable * 0.453592
                            end
                        )
                    end as numeric(15, 2)
                )
            ) over (
                partition by jk_masterbillnum,
                jk_rl_nkloadport,
                jk_rl_nkdischargeport
            ) As chrg_wght,
            'KG' as weight_unit,
            sum(
                case
                    when JS_UnitOfVolume = 'CF' then JS_ActualVolume * 0.0283168
                    else JS_ActualVolume
                end
            ) over (
                partition by jk_masterbillnum,
                jk_rl_nkloadport,
                jk_rl_nkdischargeport
            ) as Volume,
            'M3' Volume_unit
        from
            dbo.jobshipment js
            join (
                SELECT
                    X.*
                FROM
                    (
                        select
                            a.*,
                            ROW_NUMBER() OVER (
                                PARTITION BY A.JH_PARENTID
                                ORDER BY
                                    JH_GC
                            ) RANK1
                        from
                            dbo.jobheader a
                            join (
                                select
                                    JH_ParentID,
                                    min(jh_systemcreatetimeutc) jh_systemcreatetimeutc
                                from
                                    dbo.jobheader
                                group by
                                    jh_parentid
                            ) b on a.JH_ParentID = b.JH_ParentID
                            and a.jh_systemcreatetimeutc = b.jh_systemcreatetimeutc
                    ) X
                WHERE
                    RANK1 = 1
            ) jh on js.js_pk = jh.JH_ParentID
            join dbo.glbcompany g on jh.jh_gc = g.gc_pk
            JOIN dbo.jobconshiplink a ON a.jn_js = js_pk
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.jobconsoltransport jct ON jc.jk_pk = jct.jw_parentguid
        WHERE
            jw_transportmode = 'AIR'
            and (
                coalesce(jk_masterbillnum, '') <> ''
                or coalesce(jk_masterbillnum, '') <> ''
            )
            and cast(js_systemcreatetimeutc as date) >= ${date}
            and jk_iscancelled = 0
            and length(JK_MasterBillNum) > 10
    ) main
    left outer join (
        select
            DISTINCT jk_masterbillnum mawb1,
            listaGG(ltrim(rtrim(jw_voyageflight)), ';') within group (
                order by
                    jk_masterbillnum desc
            ) AS flt
        FROM
            dbo.JobConShipLink a
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.JobConsolTransport b ON JW_ParentGUID = JN_JK
            join DBO.jobshipment C on C.js_pk = a.jn_js
        where
            jw_transportmode = 'AIR'
        group by
            jk_masterbillnum
    ) mawb on main.mawb = mawb.mawb1
    left outer join (
        select
            DISTINCT jk_masterbillnum mawb,
            MIN(
                case
                    when cast(JW_ATD as date) = '1900-01-01' then null
                    else jw_atd
                end
            ) OVER (PARTITION BY jk_masterbillnum) ATD
        FROM
            dbo.JobConShipLink a
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.JobConsolTransport b ON JW_ParentGUID = JN_JK
            join DBO.jobshipment C on C.js_pk = a.jn_js
        where
            jw_transportmode = 'AIR'
    ) atd on main.mawb = atd.mawb
    left outer join (
        select
            distinct JK_MasterBillNum mawb,
            sum(
                case
                    when g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
                    else (
                        case
                            when h.AH_PostDate is null then (JR_LocalCostAmt / PRE.RE_SELLRATE)
                            else (
                                (c.AL_OSAMount) * -1 /CASE
                                    WHEN POST.RE_SELLRATE IS NULL THEN 1
                                    ELSE POST.RE_SELLRATE
                                END
                            )
                        end
                    )
                end
            ) over (partition by JK_MasterBillNum) as total_security_cost
        from
            DBO.JOBSHIPMENT JS
            JOIN dbo.jobconshiplink a ON a.jn_js = js_pk
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.jobconsoltransport jct ON jc.jk_pk = jct.jw_parentguid
            left outer JOIN DBO.JOBHEADER JH ON js.JS_PK = jh.JH_ParentID
            left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK
            and jr.jr_gc = jh.jh_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK
            and jr.jr_gc = c.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH
            and h.ah_gc = c.al_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK
            and jr.jr_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH
            and h1.ah_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk
            and c.al_gc = cc1.ac_gc
            left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk
            and jh.jh_gc = stn.gb_gc
            join dbo.glbcompany g on jr.jr_gc = g.gc_pk
            LEFT OUTER JOIN dbo.RefExchangeRate PRE ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
            AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
            AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and PRE.re_exratetype = 'BUY'
            LEFT OUTER JOIN dbo.RefExchangeRate POST ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
            AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(
                CAST(h1.AH_InvoiceDate AS DATE),
                CAST(h.AH_InvoiceDate AS DATE)
            )
            AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and POST.re_exratetype = 'BUY'
        where
            cc1.AC_Code in ('SEC', 'SECURSURC', 'SCC', 'SEC SERV', 'ISS')
            and C.AL_LineType in('CST', 'ACR')
            and jw_transportmode = 'AIR'
    ) seccst on main.mawb = seccst.mawb
    left outer join (
        select
            distinct JK_MasterBillNum mawb,
            sum(
                case
                    when g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
                    else (
                        case
                            when h.AH_PostDate is null then (JR_LocalCostAmt / PRE.RE_SELLRATE)
                            else (
                                (c.AL_OSAMount) * -1 /CASE
                                    WHEN POST.RE_SELLRATE IS NULL THEN 1
                                    ELSE POST.RE_SELLRATE
                                END
                            )
                        end
                    )
                end
            ) over (partition by JK_MasterBillNum) as total_fuel_cost
        from
            DBO.JOBSHIPMENT JS
            JOIN dbo.jobconshiplink a ON a.jn_js = js_pk
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.jobconsoltransport jct ON jc.jk_pk = jct.jw_parentguid
            left outer JOIN DBO.JOBHEADER JH ON js.JS_PK = jh.JH_ParentID
            left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK
            and jr.jr_gc = jh.jh_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK
            and jr.jr_gc = c.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH
            and h.ah_gc = c.al_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK
            and jr.jr_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH
            and h1.ah_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk
            and c.al_gc = cc1.ac_gc
            left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk
            and jh.jh_gc = stn.gb_gc
            join dbo.glbcompany g on jr.jr_gc = g.gc_pk
            LEFT OUTER JOIN dbo.RefExchangeRate PRE ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
            AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
            AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and PRE.re_exratetype = 'BUY'
            LEFT OUTER JOIN dbo.RefExchangeRate POST ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
            AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(
                CAST(h1.AH_InvoiceDate AS DATE),
                CAST(h.AH_InvoiceDate AS DATE)
            )
            AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and POST.re_exratetype = 'BUY'
        where
            cc1.AC_Code in ('FSC')
            and C.AL_LineType in('CST', 'ACR')
            and jw_transportmode = 'AIR'
    ) fuelcst on main.mawb = fuelcst.mawb
    left outer join (
        select
            distinct JK_MasterBillNum mawb,
            sum(
                case
                    when g.gc_rx_nklocalcurrency = 'USD' then JR_LocalCostAmt
                    else (
                        case
                            when h.AH_PostDate is null then (JR_LocalCostAmt / PRE.RE_SELLRATE)
                            else (
                                (c.AL_OSAMount) * -1 /CASE
                                    WHEN POST.RE_SELLRATE IS NULL THEN 1
                                    ELSE POST.RE_SELLRATE
                                END
                            )
                        end
                    )
                end
            ) over (partition by JK_MasterBillNum) as total_freight_cost
        from
            DBO.JOBSHIPMENT JS
            JOIN dbo.jobconshiplink a ON a.jn_js = js_pk
            JOIN dbo.jobconsol jc ON jc.jk_pk = a.jn_jk
            JOIN dbo.jobconsoltransport jct ON jc.jk_pk = jct.jw_parentguid
            left outer JOIN DBO.JOBHEADER JH ON js.JS_PK = jh.JH_ParentID
            left outer join DBO.JOBCHARGE jr ON jr.JR_JH = JH.JH_PK
            and jr.jr_gc = jh.jh_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C ON jr.JR_AL_APLine = C.AL_PK
            and jr.jr_gc = c.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h ON h.ah_pk = C.AL_AH
            and h.ah_gc = c.al_gc
            LEFT OUTER JOIN DBO.AccTransactionLines C1 ON jr.JR_AL_ArLine = C1.AL_PK
            and jr.jr_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccTransactionHeader h1 ON h1.ah_pk = C1.AL_AH
            and h1.ah_gc = c1.al_gc
            LEFT OUTER JOIN dbo.AccChargeCode cc1 on C.al_ac = cc1.ac_pk
            and c.al_gc = cc1.ac_gc
            left outer join dbo.GlbBranch stn on jh.jh_GB = stn.gb_pk
            and jh.jh_gc = stn.gb_gc
            join dbo.glbcompany g on jr.jr_gc = g.gc_pk
            LEFT OUTER JOIN dbo.RefExchangeRate PRE ON g.gc_rx_nklocalcurrency = PRE.RE_RX_NKEXCURRENCY
            AND CAST(PRE.RE_sTARTDATE AS DATE) = CAST(js_systemcreatetimeutc AS DATE)
            AND PRE.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and PRE.re_exratetype = 'BUY'
            LEFT OUTER JOIN dbo.RefExchangeRate POST ON h.ah_rx_nktransactioncurrency = POST.RE_RX_NKEXCURRENCY
            AND CAST(POST.RE_STARTDATE AS DATE) = coalesce(
                CAST(h1.AH_InvoiceDate AS DATE),
                CAST(h.AH_InvoiceDate AS DATE)
            )
            AND POST.re_gc = '9EEBDCD6-7BDF-460C-8210-7698FDD99758'
            and POST.re_exratetype = 'BUY'
        where
            cc1.AC_Code in ('FREIGHTER', 'FRT', 'FRT2', 'INTL AIR', 'AIRFRT')
            and C.AL_LineType in('CST', 'ACR')
            and jw_transportmode = 'AIR'
    ) freightcst on main.mawb = freightcst.mawb
 where
    Coalesce(seccst.total_security_cost, 0) + Coalesce(fuelcst.total_fuel_cost, 0) + Coalesce(freightcst.total_freight_cost, 0) > 0
    and main.chrg_wght > 0 and "Date" is not null;`;
    return cw_Query;
}
module.exports = { cwQuery }