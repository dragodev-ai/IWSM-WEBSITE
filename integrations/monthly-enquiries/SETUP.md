# Monthly counselling register

Owner and report recipient: **iwsm.official.global@gmail.com**.

The existing Google project, October register, Excel copy and scheduled jobs were verified on 20 October 2026. `Code.gs` in this directory is synchronized with the audited cloud source. Preserve the existing Script Properties when making future updates.

## What happens after submission

1. The website validates the name, Indian mobile number, optional email and course.
2. On local preview or Netlify, the server proxy validates the request and forwards it to the Google receiver; on static hosts such as GitHub Pages, `js/lead-form.js` posts directly to the deployed Google Apps Script Web App (`public_form: 'iwsm-counselling-v1'`) without exposing `SUBMISSION_TOKEN` (which remains required for server-verified `Account Logins`).
3. Google writes the row (with IST Date & Time) to the current monthly register and confirms the matching submission ID.
4. Immediately after flushing the Google Sheet row, the receiver exports the updated `.xlsx` Excel file in Google Drive and emails the `.xlsx` attachment (containing all enquiries with dates) plus live Sheet/Drive links to **iwsm.official.global@gmail.com**; if Drive or Gmail is momentarily busy, the five-minute scheduled `refreshCurrentExcel` job retries automatically without losing the saved enquiry.
5. The website shows **Thank you for choosing us.** only after Google's save acknowledgement. On uncertain or failed saves it retains the details for retry.

## Local website

Open `Start IWSM Preview.cmd`, keep it running, and use `http://127.0.0.1:4174/index.html`. Phones can use the computer's LAN address while on the same network. A `file://` page cannot submit to the backend.

The preview reads `%LOCALAPPDATA%\IWSM\monthly-enquiries.json`. It contains `IWSM_MONTHLY_SCRIPT_URL` and `IWSM_MONTHLY_SCRIPT_TOKEN` and must stay outside the website folder. `IWSM_ENQUIRY_CONFIG` can name another absolute private configuration path. Restart the preview after changing its private configuration.

## Public hosting

The current verification is for the local website. When publishing to Netlify:

1. Set `IWSM_MONTHLY_SCRIPT_URL` to the deployed Google `/exec` URL in the private environment settings.
2. Set `IWSM_MONTHLY_SCRIPT_TOKEN` to the existing `SUBMISSION_TOKEN` from Google Script Properties.
3. Set `IWSM_ENQUIRY_ORIGIN` to the public site's exact origin when needed. Netlify's own deployment URL environment values are also recognized.
4. Redeploy. Submit a clearly labelled test enquiry and verify its row, Excel refresh and monthly email.

Never include credentials in client scripts, the public project folder or logs. Google Sheets and Excel sharing should remain private to the owner and explicitly authorized users.

## Google maintenance

- `setupMonthlyReports`: installs a five-minute `refreshCurrentExcel` job and a daily `deliverMonthlyReport` job around 9 AM Asia/Kolkata. It preserves the existing token and workbooks.
- `refreshCurrentExcel`: refreshes queued Excel files and sends pending monthly links. It can be run manually from the authorized editor.
- `deliverMonthlyReport`: sends completed earlier months with an attachment and links. Only successful sends are marked delivered.
- `auditBackendHealth`: logs monthly row counts, private file links and queue/email status. It does not log visitor records or credentials and is not a public route.

Google service limits and outages can postpone exports or mail. A crash after an email is accepted but before its sent-marker is saved can cause a retry email. Existing confirmed register rows remain available independently of export/email progress.
