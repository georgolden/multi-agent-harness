/**
 * Validate an IANA timezone string
 */
export declare function validateTimezone(timezone: string): string | null;
/**
 * Parse and validate an ISO datetime string
 */
export declare function parseIsoDatetime(dateStr: string): {
    date: Date | null;
    error: string | null;
};
/**
 * Basic cron validation (5 fields, allowed characters)
 */
export declare function validateCronExpression(expr: string): string | null;
