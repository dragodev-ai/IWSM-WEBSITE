# Counselling backend status — 18 November 2026

Both the public IWSM website (`https://dragodev-ai.github.io/IWSM-Website-Options-Integrated/`) and the local preview (`http://127.0.0.1:4174/`) are connected to the institute's Google monthly register and instant Excel Gmail delivery (`iwsm.official.global@gmail.com`).

## Verified end to end

- The Google receiver is deployed under iwsm.official.global@gmail.com. Anonymous requests must pass the private server token; the browser never receives that token.
- The local preview serves the counselling POST route. Its private connection file is outside the website directory at `%LOCALAPPDATA%\IWSM\monthly-enquiries.json`.
- A clearly labelled `IWSM Backend Audit Test` enquiry was submitted through the actual website. The saved row contains the full name, mobile number, email and selected course.
- The website displayed **Thank you for choosing us.** after Google confirmed the saved submission. It then cleared the submitted fields.
- October's existing Excel file retained its file ID and contains the test row. Drive reports that it is private to the signed-in institute account.
- The email **IWSM live monthly register - October 2026** arrived in iwsm.official.global@gmail.com at approximately 5:26 PM IST with the live Google register and updating Excel links.
- The owner-only health check reported one enquiry, no pending export, no pending link email, and a recorded email timestamp.
- Both scheduled jobs are installed. An automatic `refreshCurrentExcel` execution was observed at 5:28 PM IST with a 0% error rate.

## Ongoing behavior

Every accepted enquiry saves immediately to the current month's Google Sheet. Excel is refreshed in place by a five-minute scheduled maintenance job. Google scheduling delays, quotas or outages can postpone the Excel refresh without losing an already confirmed Google Sheet record.

The live links are emailed once after the month's first accepted enquiry. The same links remain valid throughout that month. A daily morning job sends completed earlier months with their Excel attachment and links, retrying failed sends. A rare interruption between Google's email send and the saved sent-marker can cause a repeated email.

Existing Account Logins worksheets are retained. The counselling path does not depend on account sign-in. Account authentication remains a separate setup.

## Local and public access

Use the HTTP preview, not a `file://` page. The local preview must be running for localhost or same-network phone submissions. Opening `Start IWSM Preview.cmd` starts it again after a computer restart.

For a future public Netlify website, configure `IWSM_MONTHLY_SCRIPT_URL` and `IWSM_MONTHLY_SCRIPT_TOKEN` as private server environment variables and deploy the site. The localhost test does not establish that an internet-facing website has been published.

Never paste the private token into HTML, JavaScript, shared reports, or this document.
