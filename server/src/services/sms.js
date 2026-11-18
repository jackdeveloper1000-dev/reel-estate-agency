/**
 * Sends OTPs and text messages. Pick a provider with SMS_PROVIDER in server/.env:
 *   console  – prints to the server window (default, for local testing)
 *   fast2sms – https://www.fast2sms.com  (FAST2SMS_API_KEY)
 *   msg91    – https://msg91.com         (MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID)
 *   twilio   – https://www.twilio.com    (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
 * Phone numbers are E.164 (+919876543210).
 */
const { SMS } = require('../config');

const national = (phone) => phone.replace(/^\+91/, '').replace(/\D/g, ''); // 9876543210
const digits = (phone) => phone.replace(/\D/g, ''); // 919876543210

async function call(url, options, provider) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  const failed =
    !res.ok ||
    (provider === 'fast2sms' && body && body.return === false) ||
    (provider === 'msg91' && body && body.type === 'error');
  if (failed) {
    const msg = (body && (body.message || body.msg)) || text || res.statusText;
    throw new Error(`SMS (${provider}) failed: ${Array.isArray(msg) ? msg.join(', ') : msg}`);
  }
  return body;
}

async function sendText(phone, text) {
  switch (SMS.provider) {
    case 'fast2sms':
      return call('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: SMS.fast2smsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'q', message: text, numbers: national(phone), flash: 0 }),
      }, 'fast2sms');
    case 'twilio':
      return call(`https://api.twilio.com/2010-04-01/Accounts/${SMS.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${SMS.twilioSid}:${SMS.twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, From: SMS.twilioFrom, Body: text }),
      }, 'twilio');
    case 'msg91':
      // MSG91 only sends DLT-approved templates; set MSG91_NOTIFY_TEMPLATE_ID with a ##message## variable
      if (!SMS.msg91NotifyTemplateId) return console.log(`[sms:msg91] no notify template – skipped: ${text}`);
      return call('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { authkey: SMS.msg91AuthKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: SMS.msg91NotifyTemplateId, recipients: [{ mobiles: digits(phone), message: text }] }),
      }, 'msg91');
    default:
      console.log(`\n📱 [SMS to ${phone}] ${text}\n`);
  }
}

async function sendOtp(phone, code) {
  const text = `${code} is your RealAssets AI verification code. It expires in 5 minutes. Do not share it with anyone.`;
  switch (SMS.provider) {
    case 'fast2sms':
      return call('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: SMS.fast2smsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'otp', variables_values: code, numbers: national(phone), flash: 0 }),
      }, 'fast2sms');
    case 'msg91': {
      const qs = new URLSearchParams({ template_id: SMS.msg91OtpTemplateId, mobile: digits(phone), otp: code });
      return call(`https://control.msg91.com/api/v5/otp?${qs}`, {
        method: 'POST',
        headers: { authkey: SMS.msg91AuthKey, 'Content-Type': 'application/json' },
        body: '{}',
      }, 'msg91');
    }
    default:
      return sendText(phone, text);
  }
}

const isConsole = () => !['fast2sms', 'msg91', 'twilio'].includes(SMS.provider);

module.exports = { sendOtp, sendText, isConsole };
