import * as crypto from 'crypto';
import { CdkCustomResourceHandler } from 'aws-lambda';
import * as utf8 from 'utf8';

export const sign = (key: string[], msg: string) => {
  const hmac = crypto.createHmac('sha256', Buffer.from(key.map((a) => a.charCodeAt(0)))).update(utf8.encode(msg)) as any;
  return hmac.digest('binary').toString().split('');
};

export const genSmtpPassword = (key: string, region: string) => {
  const date = '11111111';
  const service = 'ses';
  const terminal = 'aws4_request';
  const message = 'SendRawEmail';
  const versionInBytes = [0x04];

  let signature = sign(utf8.encode('AWS4' + key).split(''), date);
  signature = sign(signature, region);
  signature = sign(signature, service);
  signature = sign(signature, terminal);
  signature = sign(signature, message);

  const signatureAndVersion = versionInBytes.slice(); //copy of array

  signature.forEach((a: string) => signatureAndVersion.push(a.charCodeAt(0)));

  return Buffer.from(signatureAndVersion).toString('base64');
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const region: string = event.ResourceProperties.Region;
  const secretAccessKey: string = event.ResourceProperties.SecretAccessKey;

  switch (event.RequestType) {
    case 'Create': {
      const smtpPassword = genSmtpPassword(secretAccessKey, region);
      return { PhysicalResourceId: `email-smtp.${region}.amazonaws.com/password`, Data: { Password: smtpPassword } };
    }
    case 'Update': {
      const smtpPassword = genSmtpPassword(secretAccessKey, region);
      return { PhysicalResourceId: `email-smtp.${region}.amazonaws.com/password`, Data: { Password: smtpPassword } };
    }
    case 'Delete': {
      return {};
    }
  };
};