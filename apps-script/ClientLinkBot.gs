/**
 * Send a client-link draft to the bot. Drop this file into the EXISTING Apps
 * Script project that already serves the floor /exec URL (do not create a
 * second web app). Use that file's own JSON helper. The public page never
 * sees the webhook URL or key.
 *
 * Script properties (Project Settings → Script properties):
 *   BOT_WEBHOOK_URL   HTTPS endpoint that receives the JSON payload
 *   BOT_WEBHOOK_AUTH  full Authorization header value (for example "Bearer …")
 *
 * If either property is missing or blank, the HTTP response is exactly
 *   {"ok":false,"reason":"not configured"}
 *
 * Wire AFTER the request is authenticated and session exists:
 *
 *   if (action === 'sendClientLinkToBot') return sendClientLinkToBotResponse_(body, session);
 *
 * Request (text/plain JSON, same as the other staff actions; token is the
 * staff session and is NOT forwarded to the bot):
 *   {"action":"sendClientLinkToBot","token":"…","projectId":"","projectName":"",
 *    "clientName":"","clientEmail":"","clientPhone":"","link":"","sender":"","note":"",
 *    "contacts":[{"name":"","role":"","phone":"","email":""}]}
 *
 * Webhook POST body (Content-Type application/json, Authorization: BOT_WEBHOOK_AUTH):
 *   {"projectId":"","projectName":"","clientName":"","clientEmail":"","clientPhone":"",
 *    "link":"","sender":"","note":"","contacts":[{"name":"","role":"","phone":"","email":""}]}
 * sender is session.name. The client cannot set it. contacts is the chosen
 * recipients (one or two). If the request has no contacts array, one contact is
 * built from clientName, clientPhone, and clientEmail. The session token is not forwarded.
 */
function sendClientLinkToBotResponse_(body, session) {
  try {
    return json({ ok: true, data: sendClientLinkToBot_(body, session) });
  } catch (err) {
    if (err && err.reason === 'not configured') return json({ ok: false, reason: 'not configured' });
    return json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function sendClientLinkToBot_(body, session) {
  if (!session) throw new Error('Please sign in.');
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('BOT_WEBHOOK_URL') || '').trim();
  var auth = String(props.getProperty('BOT_WEBHOOK_AUTH') || '').trim();
  if (!url || !auth) {
    var missing = new Error('not configured');
    missing.reason = 'not configured';
    throw missing;
  }
  if (!/^https:\/\//i.test(url)) throw new Error('The bot webhook must be https.');
  body = body || {};
  var payload = {
    projectId: String(body.projectId || ''),
    projectName: String(body.projectName || ''),
    clientName: String(body.clientName || ''),
    clientEmail: String(body.clientEmail || ''),
    clientPhone: String(body.clientPhone || ''),
    link: String(body.link || ''),
    sender: String(session.name || ''),
    note: String(body.note || ''),
    contacts: botContacts_(body)
  };
  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: auth },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    throw new Error('Could not reach the bot.');
  }
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('The bot did not accept the link (' + code + ').');
  return { sent: true };
}

function botContacts_(body) {
  var raw = body && Array.isArray(body.contacts) ? body.contacts : [], list = [], i, x;
  for (i = 0; i < raw.length && list.length < 2; i++) {
    x = raw[i];
    if (!x || typeof x !== 'object') continue;
    list.push({ name: String(x.name || ''), role: String(x.role || ''), phone: String(x.phone || ''), email: String(x.email || '') });
  }
  if (!list.length) list.push({ name: String(body.clientName || ''), role: '', phone: String(body.clientPhone || ''), email: String(body.clientEmail || '') });
  return list;
}
