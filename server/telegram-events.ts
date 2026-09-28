export const TELEGRAM_QUEUE="telegram-send-v1";
export const TELEGRAM_JOB_OPTIONS={heartbeatSeconds:60,expireInSeconds:90,retryLimit:2,retryDelay:5,retryBackoff:false,retentionSeconds:14*86400,deleteAfterSeconds:7*86400};
