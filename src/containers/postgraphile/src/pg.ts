import xray from 'aws-xray-sdk';
import * as pg from 'original-pg';

const enableXrayTracing = (typeof process.env.ENABLE_XRAY_TRACING == 'undefined') ? false : true;

module.exports = (enableXrayTracing) ? xray.capturePostgres(pg) : pg;