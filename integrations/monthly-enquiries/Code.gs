const REPORT_EMAIL = 'iwsm.official.global@gmail.com';
const REPORT_ZONE = 'Asia/Kolkata';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PUBLIC_FORM_KEY = 'iwsm-counselling-v1';
const PUBLIC_RATE_LIMIT_PER_MIN = 20;
const UUID_V4_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REQUEST_LOCK_MS = 3000;
const MAINTENANCE_LEASE_MS = 10 * 60 * 1000;

function properties_() { return PropertiesService.getScriptProperties(); }
function stateLocked_(action) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(REQUEST_LOCK_MS)) throw Error('Register state is busy');
  try { return action(); } finally { lock.releaseLock(); }
}
function maintenanceLease_() {
  try { return JSON.parse(properties_().getProperty('MAINTENANCE_LEASE') || 'null'); }
  catch (error) { return null; }
}
function assertMaintenance_(token) {
  const lease = maintenanceLease_();
  if (!lease || lease.token !== token) throw Error('Maintenance lease no longer owned');
  return lease;
}
function acquireMaintenance_() {
  return stateLocked_(() => {
    const lease = maintenanceLease_();
    if (lease && lease.expires > Date.now()) return null;
    const token = Utilities.getUuid();
    properties_().setProperty('MAINTENANCE_LEASE', JSON.stringify({ token: token, expires: Date.now() + MAINTENANCE_LEASE_MS }));
    return token;
  });
}
function renewMaintenance_(token) {
  return stateLocked_(() => {
    assertMaintenance_(token);
    properties_().setProperty('MAINTENANCE_LEASE', JSON.stringify({ token: token, expires: Date.now() + MAINTENANCE_LEASE_MS }));
  });
}
function releaseMaintenance_(token) {
  try {
    stateLocked_(() => {
      const lease = maintenanceLease_();
      // A stale owner must never remove a replacement lease acquired after expiry.
      if (lease && lease.token === token) properties_().deleteProperty('MAINTENANCE_LEASE');
    });
  } catch (error) { console.error('Maintenance lease release deferred until expiry.'); }
}
function monthKey_(date) { return Utilities.formatDate(date, REPORT_ZONE, 'yyyy-MM'); }
function monthName_(key) { return Utilities.formatDate(new Date(key + '-15T12:00:00Z'), REPORT_ZONE, 'MMMM yyyy'); }
function previousMonth_(key) { const parts = key.split('-').map(Number); return monthKey_(new Date(Date.UTC(parts[0], parts[1] - 2, 15))); }
function response_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function failure_(code) { return response_({ success: false, code: code }); }
function safeText_(value) { const text = String(value || ''); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function hasControls_(value) { return /[\u0000-\u001f\u007f]/.test(String(value || '')); }
function checkPublicRateLimit_() {
  try {
    const cache = CacheService.getScriptCache();
    const bucket = 'PUB_ENQ_' + Math.floor(Date.now() / 60000);
    const count = (Number(cache.get(bucket)) || 0) + 1;
    if (count > PUBLIC_RATE_LIMIT_PER_MIN) return false;
    cache.put(bucket, String(count), 90);
    return true;
  } catch (error) {
    return true;
  }
}
function folder_() {
  const p = properties_(), existing = p.getProperty('FOLDER_ID');
  if (existing) return DriveApp.getFolderById(existing);
  const folder = DriveApp.createFolder('IWSM Monthly Registers');
  p.setProperty('FOLDER_ID', folder.getId());
  return folder;
}
function styleSheet_(sheet, headers, widths) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#126744').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
}
function book_(key) {
  const p = properties_(), existing = p.getProperty('SHEET_' + key);
  let book;
  if (existing) book = SpreadsheetApp.openById(existing);
  else {
    book = SpreadsheetApp.create('IWSM Register - ' + monthName_(key));
    book.setSpreadsheetTimeZone(REPORT_ZONE);
    DriveApp.getFileById(book.getId()).moveTo(folder_());
    const sheet = book.getSheets()[0];
    sheet.setName('Course Enquiries');
    styleSheet_(sheet, ['Full Name', 'Mobile Number', 'Email Address', 'Selected Course', 'Submitted (IST)', 'Submission ID'], [220, 160, 280, 370, 180, 160]);
    sheet.hideColumns(6);
    p.setProperty('SHEET_' + key, book.getId());
    p.setProperty('PENDING_EXPORT_' + key, '1');
  }
  // Existing six-column enquiry rows and the separate login worksheet are retained.
  const enquirySheet = book.getSheetByName('Course Enquiries') || book.getSheets()[0];
  if (enquirySheet.getRange(1, 7).getValue() !== 'Payload Fingerprint') {
    enquirySheet.getRange(1, 7).setValue('Payload Fingerprint');
    enquirySheet.hideColumns(7);
  }
  if (!book.getSheetByName('Account Logins')) {
    const sheet = book.insertSheet('Account Logins');
    styleSheet_(sheet, ['Full Name', 'Email Address', 'First Login (IST)', 'Latest Login (IST)', 'Provider', 'User ID'], [220, 280, 180, 180, 140, 280]);
    sheet.hideColumns(6);
  }
  return book;
}
function excel_(key, token) {
  const snapshot = stateLocked_(() => {
    assertMaintenance_(token);
    const p = properties_(), bookId = p.getProperty('SHEET_' + key);
    if (!bookId) throw Error('Month does not exist');
    return { bookId: bookId, excelId: p.getProperty('XLSX_' + key), revision: p.getProperty('QUEUE_REV_' + key) || '0' };
  });
  renewMaintenance_(token);
  SpreadsheetApp.flush();
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const result = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + snapshot.bookId + '/export?mimeType=' + encodeURIComponent(XLSX_MIME), { headers: headers, muteHttpExceptions: true });
  if (result.getResponseCode() !== 200) throw Error('Excel export failed');
  renewMaintenance_(token);
  const blob = result.getBlob().setContentType(XLSX_MIME).setName('IWSM Register - ' + monthName_(key) + '.xlsx');
  let excelId = snapshot.excelId;
  if (excelId) {
    const update = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + excelId + '?uploadType=media', { method: 'patch', headers: headers, contentType: XLSX_MIME, payload: blob.getBytes(), muteHttpExceptions: true });
    if (update.getResponseCode() !== 200) throw Error('Excel update failed');
  } else excelId = folder_().createFile(blob).getId();
  stateLocked_(() => {
    assertMaintenance_(token);
    const p = properties_();
    if (!snapshot.excelId) p.setProperty('XLSX_' + key, excelId);
    // A submission saved during the export must keep its newer revision queued.
    if ((p.getProperty('QUEUE_REV_' + key) || '0') === snapshot.revision) p.deleteProperty('PENDING_EXPORT_' + key);
  });
  return blob;
}
function fingerprint_(fields) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(fields), Utilities.Charset.UTF_8)
    .map(value => ('0' + ((value + 256) % 256).toString(16)).slice(-2)).join('');
}
function normalize_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const login = input.record_type === 'login';
  if (input.record_type && !login && input.record_type !== 'enquiry') return null;
  const text = (key, optional) => input[key] == null && optional ? '' : typeof input[key] === 'string' ? input[key].trim() : null;
  const name = text('full_name', login), email = text('email', !login);
  if (name == null || name.length > 120 || hasControls_(name) || email == null || email.length > 254 || hasControls_(email) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  if (login) {
    const user = text('user_id', false), provider = text('provider', true);
    if (!user || user.length > 100 || !email || provider == null || provider.length > 80) return null;
    return { login: true, full_name: name, email: email, user_id: user, provider: provider };
  }
  const rawPhone = text('phone', false), course = text('course', false), rawId = text('submission_id', false);
  if (rawPhone == null || rawPhone.length > 32 || course == null || !course || course.length > 300 || hasControls_(course) || !rawId || !UUID_V4_RE.test(rawId)) return null;
  if (name.length < 2 || !/[\p{L}]/u.test(name)) return null;
  const phoneMatch = rawPhone.replace(/[\s()-]/g, '').match(/^(?:\+?91)?([6-9]\d{9})$/);
  if (!phoneMatch) return null;
  const phone = phoneMatch[1], id = rawId.toLowerCase();
  return { login: false, full_name: name, phone: phone, email: email, course: course, submission_id: id, fields: [name, phone, email, course] };
}
function findSubmission_(key, data) {
  const p = properties_(), keys = [key, previousMonth_(key)];
  for (const candidate of keys) {
    const id = p.getProperty('SHEET_' + candidate);
    if (!id) continue;
    const book = SpreadsheetApp.openById(id), sheet = book.getSheetByName('Course Enquiries') || book.getSheets()[0];
    if (sheet.getLastRow() < 2) continue;
    const found = sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).createTextFinder(data.submission_id).matchEntireCell(true).findNext();
    if (!found) continue;
    const stored = sheet.getRange(found.getRow(), 1, 1, 7).getValues()[0];
    const same = stored[6] ? stored[6] === fingerprint_(data.fields) : data.fields.every((value, index) => String(stored[index]) === value || String(stored[index]) === safeText_(value));
    return { month: candidate, same: same };
  }
  return null;
}
function queue_(key, isEnquiry) {
  const p = properties_();
  p.setProperty('QUEUE_REV_' + key, String((Number(p.getProperty('QUEUE_REV_' + key)) || 0) + 1));
  p.setProperty('PENDING_EXPORT_' + key, '1');
  if (isEnquiry) {
    p.setProperty('PENDING_EMAIL_' + key, '1');
    if (!p.getProperty('LINK_EMAILED_' + key)) p.setProperty('PENDING_LINK_' + key, '1');
  }
}
function saved_(data, key, duplicate) {
  const result = { success: true, status: 'saved', month: key };
  if (!data.login) { result.submission_id = data.submission_id; result.duplicate = duplicate; }
  return response_(result);
}
function doPost(e) {
  let input;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 12000) return failure_('invalid_request');
    input = JSON.parse(e.postData.contents);
  } catch (error) { return failure_('invalid_request'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure_('invalid_request');
  if (input['bot-field']) return failure_('invalid_request');
  const secret = properties_().getProperty('SUBMISSION_TOKEN');
  const hasServerSecret = Boolean(secret && input.secret === secret);
  if (input.public_form === PUBLIC_FORM_KEY && input.action === 'deliver_pending') {
    try { refreshCurrentExcel(); } catch (err) { console.error('Background Excel/email delivery deferred to scheduled trigger.'); }
    return response_({ success: true, status: 'delivered' });
  }
  const isLogin = input.record_type === 'login';
  const isPublicEnquiry = !isLogin && input.public_form === PUBLIC_FORM_KEY;
  if (!hasServerSecret && !isPublicEnquiry) return failure_('unauthorized');
  if (!hasServerSecret && !checkPublicRateLimit_()) return failure_('rate_limited');
  const data = normalize_(input);
  if (!data) return failure_('invalid_details');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(REQUEST_LOCK_MS)) return failure_('storage_busy');
  try {
    const now = new Date(), key = monthKey_(now), stamp = Utilities.formatDate(now, REPORT_ZONE, 'yyyy-MM-dd HH:mm:ss');
    if (!data.login) {
      const existing = findSubmission_(key, data);
      if (existing) {
        if (!existing.same) return failure_('submission_conflict');
        return saved_(data, existing.month, true);
      }
    }
    const book = book_(key);
    // Queue before the write: if execution stops after flush, maintenance still retries.
    queue_(key, !data.login);
    if (data.login) {
      const sheet = book.getSheetByName('Account Logins');
      const found = sheet.getLastRow() > 1 ? sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).createTextFinder(data.user_id).matchEntireCell(true).findNext() : null;
      if (found) sheet.getRange(found.getRow(), 4).setNumberFormat('@').setValue(stamp);
      else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setNumberFormat('@').setValues([[data.full_name, data.email, stamp, stamp, data.provider, data.user_id].map(safeText_)]);
    } else {
      const sheet = book.getSheetByName('Course Enquiries') || book.getSheets()[0];
      const row = data.fields.concat([stamp, data.submission_id]).map(safeText_).concat([fingerprint_(data.fields)]);
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setNumberFormat('@').setValues([row]);
    }
    SpreadsheetApp.flush();
    // Return immediately (<1s) so visitor UI confirms without waiting on Drive/Gmail I/O.
    return saved_(data, key, false);
  } catch (error) {
    console.error('Monthly register storage did not confirm completion.');
    return failure_('storage_unavailable');
  } finally {
    lock.releaseLock();
  }
}
function monthKeys_() {
  return Object.keys(properties_().getProperties()).filter(key => /^SHEET_\d{4}-\d{2}$/.test(key)).map(key => key.slice(6)).sort();
}
function links_(key) {
  const p = properties_(), sheet = p.getProperty('SHEET_' + key), excel = p.getProperty('XLSX_' + key);
  if (!sheet || !excel) throw Error('Register links pending');
  return 'Google Sheets (live register):\nhttps://docs.google.com/spreadsheets/d/' + sheet + '/edit\n\nExcel file in Google Drive (updated automatically):\nhttps://drive.google.com/file/d/' + excel + '/view';
}
function notifyEnquiryExcel_(key, token, excelBlob) {
  const snapshot = stateLocked_(() => {
    assertMaintenance_(token);
    const p = properties_();
    const sheetId = p.getProperty('SHEET_' + key);
    if (!sheetId) return null;
    return {
      sheetId: sheetId,
      prevEmailedRow: Math.max(1, Number(p.getProperty('EMAILED_ROW_' + key)) || 1),
      linkEmailed: Boolean(p.getProperty('LINK_EMAILED_' + key)),
      revision: p.getProperty('QUEUE_REV_' + key) || '0',
      links: links_(key)
    };
  });
  if (!snapshot) return;
  const book = SpreadsheetApp.openById(snapshot.sheetId);
  const enquiries = book.getSheetByName('Course Enquiries') || book.getSheets()[0];
  const lastRow = enquiries.getLastRow();
  if (lastRow < 2) {
    stateLocked_(() => {
      assertMaintenance_(token);
      const p = properties_();
      if ((p.getProperty('QUEUE_REV_' + key) || '0') === snapshot.revision) {
        p.deleteProperty('PENDING_EMAIL_' + key);
        p.deleteProperty('PENDING_LINK_' + key);
      }
    });
    return;
  }
  if (lastRow <= snapshot.prevEmailedRow && snapshot.linkEmailed) {
    stateLocked_(() => {
      assertMaintenance_(token);
      const p = properties_();
      if ((p.getProperty('QUEUE_REV_' + key) || '0') === snapshot.revision) {
        p.deleteProperty('PENDING_EMAIL_' + key);
        p.deleteProperty('PENDING_LINK_' + key);
      }
    });
    return;
  }
  const startRow = Math.min(snapshot.prevEmailedRow + 1, lastRow);
  const newCount = lastRow - startRow + 1;
  const newRows = enquiries.getRange(startRow, 1, newCount, 5).getDisplayValues();
  const latest = newRows[newRows.length - 1];
  const lines = newRows.map((r, idx) => (
    (newCount > 1 ? 'Enquiry #' + (idx + 1) + ':\n' : '') +
    '• Full Name: ' + (r[0] || '—') + '\n' +
    '• Mobile Number: +91 ' + (r[1] || '—') + '\n' +
    '• Email Address: ' + (r[2] || 'Not provided') + '\n' +
    '• Course / Interest: ' + (r[3] || '—') + '\n' +
    '• Submitted Date & Time (IST): ' + (r[4] || '—')
  )).join('\n\n');
  const subject = newCount === 1
    ? 'New IWSM Course Enquiry — ' + latest[0] + ' (' + latest[4] + ' IST)'
    : 'New IWSM Course Enquiries (' + newCount + ') — ' + monthName_(key) + ' Excel Register';
  const body =
    'A new course counselling enquiry has been saved to the IWSM ' + monthName_(key) + ' Excel register (total enquiries this month: ' + (lastRow - 1) + ').\n\n' +
    lines + '\n\n' +
    'Attached: Updated Excel sheet (IWSM Register - ' + monthName_(key) + '.xlsx) containing all enquiries with dates.\n\n' +
    snapshot.links;
  renewMaintenance_(token);
  const attachment = excelBlob || excel_(key, token);
  MailApp.sendEmail({
    to: REPORT_EMAIL,
    subject: subject,
    body: body,
    attachments: [attachment]
  });
  stateLocked_(() => {
    assertMaintenance_(token);
    const p = properties_();
    const prevSaved = Math.max(1, Number(p.getProperty('EMAILED_ROW_' + key)) || 1);
    if (lastRow > prevSaved) p.setProperty('EMAILED_ROW_' + key, String(lastRow));
    p.setProperty('LINK_EMAILED_' + key, new Date().toISOString());
    if ((p.getProperty('QUEUE_REV_' + key) || '0') === snapshot.revision) {
      p.deleteProperty('PENDING_EMAIL_' + key);
      p.deleteProperty('PENDING_LINK_' + key);
    }
  });
}
function refreshCurrentExcel() {
  let token;
  try { token = acquireMaintenance_(); } catch (error) { return; }
  if (!token) return;
  try {
    const current = monthKey_(new Date()), p = properties_(), started = Date.now();
    stateLocked_(() => { assertMaintenance_(token); book_(current); });
    for (const key of monthKeys_()) {
      if (Date.now() - started > 240000) break;
      try {
        renewMaintenance_(token);
        const needsEmail = Boolean(p.getProperty('PENDING_EMAIL_' + key) || p.getProperty('PENDING_LINK_' + key));
        const needsExport = Boolean(p.getProperty('PENDING_EXPORT_' + key) || !p.getProperty('XLSX_' + key) || needsEmail);
        let blob = null;
        if (needsExport) blob = excel_(key, token);
        if (!p.getProperty('PENDING_EXPORT_' + key) && (p.getProperty('PENDING_EMAIL_' + key) || p.getProperty('PENDING_LINK_' + key))) {
          notifyEnquiryExcel_(key, token, blob);
        }
      } catch (error) { console.error('Monthly register maintenance pending for ' + key); }
    }
  } finally { releaseMaintenance_(token); }
}
function deliverMonthlyReport() {
  let token;
  try { token = acquireMaintenance_(); } catch (error) { return; }
  if (!token) return;
  try {
    const p = properties_(), current = monthKey_(new Date()), started = Date.now();
    for (const key of monthKeys_()) {
      if (Date.now() - started > 240000) break;
      if (key >= current || p.getProperty('EMAILED_' + key)) continue;
      try {
        const attachment = excel_(key, token);
        renewMaintenance_(token);
        MailApp.sendEmail({ to: REPORT_EMAIL, subject: 'IWSM monthly register - ' + monthName_(key), body: 'Attached is your completed monthly register, with separate worksheets for course enquiries and account logins.\n\n' + links_(key), attachments: [attachment] });
        stateLocked_(() => {
          assertMaintenance_(token);
          p.setProperty('EMAILED_' + key, new Date().toISOString());
          p.setProperty('LINK_EMAILED_' + key, new Date().toISOString());
          p.deleteProperty('PENDING_LINK_' + key);
        });
      } catch (error) { console.error('Monthly report delivery pending for ' + key); }
    }
  } finally { releaseMaintenance_(token); }
}
function setupMonthlyReports() {
  const p = properties_();
  if (!p.getProperty('SUBMISSION_TOKEN')) p.setProperty('SUBMISSION_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  const owned = ['refreshCurrentExcel', 'deliverMonthlyReport'];
  const existing = ScriptApp.getProjectTriggers().filter(trigger => owned.includes(trigger.getHandlerFunction()));
  // Create replacements before removing working triggers. Failed creation preserves retries.
  const created = [];
  try {
    created.push(ScriptApp.newTrigger('refreshCurrentExcel').timeBased().everyMinutes(1).create());
    created.push(ScriptApp.newTrigger('deliverMonthlyReport').timeBased().everyDays(1).atHour(9).inTimezone(REPORT_ZONE).create());
  } catch (error) {
    created.forEach(trigger => { try { ScriptApp.deleteTrigger(trigger); } catch (ignored) {} });
    throw error;
  }
  existing.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  refreshCurrentExcel();
  console.log('Monthly register maintenance configured.');
}

// Run from the authorized Apps Script editor; this is not a web-app route.
function auditBackendHealth() {
  const key = monthKey_(new Date()), p = properties_();
  const sheetId = p.getProperty('SHEET_' + key), excelId = p.getProperty('XLSX_' + key);
  let enquiries = 0, logins = 0;
  if (sheetId) {
    const book = SpreadsheetApp.openById(sheetId);
    const enquirySheet = book.getSheetByName('Course Enquiries') || book.getSheets()[0];
    const loginSheet = book.getSheetByName('Account Logins');
    enquiries = Math.max(0, enquirySheet.getLastRow() - 1);
    logins = loginSheet ? Math.max(0, loginSheet.getLastRow() - 1) : 0;
  }
  console.log(JSON.stringify({
    month: key,
    enquiry_rows: enquiries,
    login_rows: logins,
    emailed_rows: Number(p.getProperty('EMAILED_ROW_' + key)) ? Math.max(0, Number(p.getProperty('EMAILED_ROW_' + key)) - 1) : 0,
    sheets_url: sheetId ? 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit' : null,
    excel_url: excelId ? 'https://drive.google.com/file/d/' + excelId + '/view' : null,
    pending_export: p.getProperty('PENDING_EXPORT_' + key) === '1',
    pending_email: p.getProperty('PENDING_EMAIL_' + key) === '1',
    link_emailed_at: p.getProperty('LINK_EMAILED_' + key) || null,
    report_emailed_at: p.getProperty('EMAILED_' + key) || null
  }));
}
