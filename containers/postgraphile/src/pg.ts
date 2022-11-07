import xray from 'aws-xray-sdk';
import * as pg from 'original-pg';

const enableXrayTracing = (process.env.ENABLE_XRAY_TRACING == 'true') ? true : false;

module.exports = (enableXrayTracing) ? xray.capturePostgres(pg) : pg;