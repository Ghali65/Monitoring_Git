

WITH date_series AS (
    -- Génération d'une série de dates (3 ans autour d'aujourd'hui)
    SELECT 
        toDate('2024-01-01') + number as date_day
    FROM numbers(1500) 
)
SELECT
    toYYYYMMDD(date_day) as date_id,
    date_day as full_date,
    toYear(date_day) as year,
    toMonth(date_day) as month,
    toDayOfMonth(date_day) as day,
    toQuarter(date_day) as quarter,
    CASE toDayOfWeek(date_day)
        WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' WHEN 7 THEN 'Sunday'
    END as day_name,
    CASE toMonth(date_day)
        WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March'
        WHEN 4 THEN 'April' WHEN 5 THEN 'May' WHEN 6 THEN 'June'
        WHEN 7 THEN 'July' WHEN 8 THEN 'August' WHEN 9 THEN 'September'
        WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
    END as month_name,
    if(toDayOfWeek(date_day) IN (6, 7), 1, 0) as is_weekend
FROM date_series