  
# PE-Warranty-Backend — Developer Documentation

> **Last Updated:** March 2026  
> A Node.js / Express backend that handles warranty certificate generation, Firestore data management, and transactional email delivery for the **True Sun Trading Company** warranty workflow.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Project Structure](#3-project-structure)
4. [Environment Variables](#4-environment-variables)
5. [Application Bootstrap](#5-application-bootstrap)
6. [Security Layer](#6-security-layer)
7. [Firebase Integration](#7-firebase-integration)
8. [Authentication Middleware](#8-authentication-middleware)
9. [Email Service (Brevo)](#9-email-service-brevo)
10. [Utility / Helper Functions](#10-utility--helper-functions)
11. [API Endpoints](#11-api-endpoints)
    - [POST /test](#post-test)
    - [POST /send-rejection-email](#post-send-rejection-email)
    - [POST /api/admin-log](#post-apiadmin-log)
    - [GET /api/admin-logs](#get-apiadmin-logs)
    - [POST /api/requests](#post-apirequests)
    - [PUT /api/requests/:id](#put-apirequestsid)
    - [GET /api/requests/:id](#get-apirequestsid)
    - [GET /](#get-)
12. [Document Generation Workflow](#12-document-generation-workflow)
13. [DOCX Templates](#13-docx-templates)
14. [Firestore Collections & Schema](#14-firestore-collections--schema)
15. [Error Handling Strategy](#15-error-handling-strategy)
16. [How to Run Locally](#16-how-to-run-locally)
17. [Deployment Notes](#17-deployment-notes)
18. [Allowed Origins (CORS)](#18-allowed-origins-cors)

---

## 1. Project Overview

This backend serves two frontend applications:

| Frontend | URL |
|---|---|
| Warranty Form (user-facing) | `https://pe-warranty-form.vercel.app` |
| Warranty Dashboard (admin) | `https://pe-warranty-dashboard.vercel.app` |

**Core responsibilities:**
- Accept warranty certificate requests submitted by EPC (Engineering, Procurement & Construction) companies.
- Auto-generate sequential, unique warranty IDs (e.g. `WR_1677`).
- Create a merged `.docx` document by filling pre-built Word templates with request data.
- Email the generated document to the Premier Energies admin.
- Email a confirmation/rejection notice to the EPC contact person.
- Maintain an admin audit-log in Firestore.

---

## 2. Tech Stack & Dependencies

| Package | Purpose |
|---|---|
| `express` v5 | HTTP server / routing |
| `firebase` (client SDK) | Read/write Firestore (client-side emulation on the backend) |
| `firebase-admin` | Verify Firebase Auth ID tokens |
| `cors` | Cross-origin request filtering |
| `helmet` | Secure HTTP response headers |
| `express-rate-limit` | IP-based rate limiting |
| `dotenv` | Load environment variables from `.env` |
| `axios` | HTTP client — used to call Brevo API & fetch remote images |
| `pizzip` | Zip/unzip `.docx` files in memory |
| `docxtemplater` | Fill placeholders `{placeholder}` inside `.docx` templates |
| `docxtemplater-image-module-free` | Embed images fetched from URLs into a `.docx` |
| `docx-merger` | Merge multiple `.docx` buffers into one |
| `jszip` | Apply DEFLATE compression to the final merged `.docx` |

---

## 3. Project Structure

```
PE-Warranty-Backend/
├── index.js          ← Entire application (single file)
├── package.json      ← Project metadata & dependencies
├── package-lock.json ← Locked dependency tree
├── template.docx     ← (Legacy / unused — kept for reference)
├── template1.docx    ← Cover page template (≤ 50 serial numbers)
├── template2.docx    ← Overflow serial-numbers table (column-wise, paginated)
├── template3.docx    ← Site pictures / images template
└── DOCUMENTATION.md  ← This file
```

> **Note:** The entire backend logic lives in `index.js`. There is intentionally no subdirectory structure.

---

## 4. Environment Variables

Create a `.env` file at project root with the following keys:

```env
# Firebase Client SDK Config
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Firebase Admin (token verification uses the same projectId)
# No service-account key file is used; Application Default Credentials (ADC) are assumed.

# Email
SMTP_EMAIL=no-reply@truesuntradingcompany.com   # Displayed as sender address
BREVO_API_KEY=                                   # Brevo (ex-Sendinblue) transactional email API key

# Access Control
VITE_SUPER_ADMIN_EMAIL=Office@truesuntradingcompany.com
```

> If `BREVO_API_KEY` is absent at startup, email sending is silently skipped (a warning is logged). All other env variables are required for correct operation.

---

## 5. Application Bootstrap

```
index.js (line 17)
  express()         → create app
  app.use(helmet()) → add security headers
  app.use(limiter)  → attach rate limiter
  app.use(cors(...))→ whitelist allowed origins
  app.use(express.json({ limit: "10mb" })) → parse JSON bodies up to 10 MB
  initializeClientApp(firebaseConfig) → connect Firebase client SDK
  admin.initializeApp({ projectId }) → connect Firebase Admin SDK
  app.listen(5000)  → start HTTP server on port 5000
```

---

## 6. Security Layer

### 6.1 Helmet (`index.js` line 20)
Sets standard security headers (CSP, X-Frame-Options, HSTS, etc.) for every response.

### 6.2 Rate Limiter (`index.js` lines 23–28)
```
Window : 15 minutes
Max    : 100 requests per IP per window
Response on breach: { success: false, error: "Too many requests..." }
```

### 6.3 CORS (`index.js` lines 31–49)
Only the origins listed in `allowedOrigins` are allowed. Requests from unknown origins receive a `CORS` error. `credentials: true` enables cookies/auth-headers from the frontend.

---

## 7. Firebase Integration

Two Firebase instances are initialised on startup:

| Instance | SDK | Purpose |
|---|---|---|
| `firebaseApp` / `db` | Firebase Client SDK (`firebase/firestore`) | Read/write Firestore collections (`requests`, `admin_logs`, `counters`) |
| `admin` | Firebase Admin SDK (`firebase-admin`) | Verify Firebase Auth JWT tokens sent from the frontend |

> The Admin SDK uses **Application Default Credentials (ADC)** — no service-account JSON key is bundled. On Render/Cloud Run this requires setting up workload identity or providing `GOOGLE_APPLICATION_CREDENTIALS`.

---

## 8. Authentication Middleware

```js
// index.js lines 93–108
const verifyToken = async (req, res, next) => { ... }
```

**How it works:**
1. Reads the `Authorization` header and expects `Bearer <firebase-id-token>`.
2. Calls `admin.auth().verifyIdToken(token)`.
3. On success: attaches the decoded payload to `req.user` and calls `next()`.
4. On failure: responds with `401 Unauthorized` or `403 Forbidden`.

**Which endpoints use it:**  
`POST /test`, `POST /send-rejection-email`, `POST /api/admin-log`, `GET /api/admin-logs`

> `/api/requests` (POST, PUT, GET) does **not** use `verifyToken` — it is publicly accessible (the form submits without a login).

---

## 9. Email Service (Brevo)

```js
// index.js lines 116–140
async function sendBrevoEmail(payload) { ... }
```

A thin wrapper around an `axios.post` call to `https://api.brevo.com/v3/smtp/email`.

**Payload shape:**
```js
{
  sender: { email, name },
  to: [{ email, name }],
  subject: "...",
  htmlContent: "...",          // HTML string of email body
  attachment: [{ content, name }]  // base64 content + filename (optional)
}
```

**Usage pattern:**  
`sendBrevoEmail(payload)` → called inside a `try/catch`; email errors never cause the main request to fail — they are caught and logged separately.

---

## 10. Utility / Helper Functions

### `getImageModule()` — lines 150–161
Returns a configured `docxtemplater-image-module-free` instance.
- **`getImage(url)`** — fetches image bytes via `axios.get` with `responseType: "arraybuffer"`.
- **`getSize()`** — always returns `[550, 450]` pixels (hardcoded).

### `columnWiseTable(data, rowsPerCol, cols)` — lines 164–177
Transforms a flat array of serial numbers into a 2D table object structured **column-first**, used for the overflow serial-number template.

```
Input : ["SN1","SN2","SN3",…]
Output: [ { c0: "SN1", c1: "SN36", c2: "SN71", … }, … ]  (rowsPerCol=35, cols=5)
```

Constants:
- `ROWS_PER_COLUMN = 35` — rows per column in `template2.docx`
- `TOTAL_COLUMNS   = 5`  — number of columns in `template2.docx`

### `splitIntoPages(data, pageSize = 175)` — lines 180–186
Chunks an array into sub-arrays of `pageSize` (default 175 = 35 rows × 5 cols).  
Used to create multi-page overflow tables.

### `compressDocx(buffer)` — lines 188–196
Re-zips a `.docx` buffer (which is already a ZIP) using JSZip with DEFLATE level 9 (maximum compression) to reduce file size before attaching to the email.

---

## 11. API Endpoints

### `POST /test`
**Auth:** `verifyToken` required  
**Purpose:** Core document-generation endpoint — creates warranty certificate `.docx`, emails it to the admin, and sends a confirmation email to the EPC contact.

**Request body (JSON):**
```json
{
  "serialNumbers": ["SN001", "SN002", ...],
  "sitePictures":  ["https://...", "https://..."],
  "WARR_No":       "WR_1677",
  "EPC_Email":     "contact@epc.com",
  "EPC_Per":       "John Doe",
  // … all other template placeholder fields
}
```

**Logic flow:**
```
If serialNumbers.length > 50:
  Template 1 ← first 50 serial numbers + all form fields
  Template 2 ← remaining serial numbers  (column-wise, paginated)
  Template 3 ← site pictures (images)
  Merge: [template1, template2, template3]
Else:
  Template 1 ← all serial numbers (up to 50, rest blank)
  Template 3 ← site pictures
  Merge: [template1, template3]

→ Compress merged .docx
→ Send admin email with .docx attachment
→ Send EPC confirmation email (if EPC_Email provided)
→ Return 200 { success: true }
```

**Response:**
```json
{ "message": "Document generated successfully (Email attempt made)", "success": true }
```

---

### `POST /send-rejection-email`
**Auth:** `verifyToken` required  
**Purpose:** Sends a styled rejection email to the EPC contact when an admin rejects a warranty request from the dashboard.

**Request body:**
```json
{
  "email":   "contact@epc.com",
  "name":    "John Doe",
  "reason":  "Serial numbers are incorrect",
  "WARR_No": "WR_1677"
}
```

**Response:**
```json
{ "success": true, "message": "Rejection email sent successfully" }
```

---

### `POST /api/admin-log`
**Auth:** `verifyToken` required  
**Purpose:** Writes an audit log entry to the `admin_logs` Firestore collection when an admin performs an action on the dashboard.

**Request body:**
```json
{
  "adminEmail": "admin@truesun.com",
  "action":     "Approved request WR_1677",
  "details":    { "requestId": "WR_1677" }
}
```

**Firestore write:**
```
Collection : admin_logs
Fields     : adminEmail, action, details, timestamp (serverTimestamp)
```

**Response:** `{ "success": true, "message": "Log saved successfully" }`

---

### `GET /api/admin-logs`
**Auth:** `verifyToken` required + super-admin email check  
**Purpose:** Returns all audit logs ordered by timestamp descending. Only the super-admin email (`VITE_SUPER_ADMIN_EMAIL`) may access this endpoint.

**Security check:**  
The email is read from `req.user.email` (the verified token) — NOT from a query parameter, preventing spoofing.

**Response:**
```json
{
  "success": true,
  "logs": [
    { "id": "abc123", "adminEmail": "...", "action": "...", "details": {}, "timestamp": "..." }
  ]
}
```

---

### `POST /api/requests`
**Auth:** None (public)  
**Purpose:** Submits a new warranty certificate request. Auto-generates a unique, sequential ID like `WR_1677`.

**ID generation algorithm (Firestore Transaction):**
1. Reads the `counters/warranty_cert` document.
2. If it doesn't exist, starts from `1677`.
3. If `currentValue < 1677`, starts from `1677`.
4. Otherwise increments by 1.
5. Checks that `requests/WR_{nextId}` doesn't already exist (retries up to 10 times).
6. Sets the new request document + updates the counter atomically.

> Using a Firestore transaction ensures that concurrent submissions from multiple users never get the same ID.

**Request body:** Any form fields (spread into the document). A `status: "pending"` field is automatically added.

**Response:**
```json
{ "id": "WR_1677", "message": "Request submitted successfully" }
```

---

### `PUT /api/requests/:id`
**Auth:** None (public)  
**Purpose:** Re-submits / updates an existing request (e.g., after a rejection). Resets `status` to `"pending"` and updates `updatedAt`.

**URL param:** `:id` — the warranty request ID (e.g., `WR_1677`)

**Response:**
```json
{ "id": "WR_1677", "message": "Request updated successfully" }
```

---

### `GET /api/requests/:id`
**Auth:** None (public)  
**Purpose:** Fetch a single request document (e.g., for the user to see their submission status).

**URL param:** `:id` — the warranty request ID

**Response:** The raw Firestore document data, or `404` if not found.

---

### `GET /`
Health-check endpoint. Returns plain text `"I am alive"`. Used by uptime monitors (e.g., Render keeps the server warm).

---

## 12. Document Generation Workflow

```
POST /test
│
├─ Read template1.docx, template2.docx, template3.docx from disk
│
├─ If serialNumbers.length > 50
│   ├─ Render template1: first 50 serials + all form fields
│   └─ Render template2: remaining serials → columnWiseTable → paginated
│
├─ Else
│   └─ Render template1: all ≤50 serials (unfilled slots = "")
│
├─ Render template3: fetch images from URLs → embed via ImageModule
│
├─ Merge documents with DocxMerger
│   └─ [template1] + [template2 if needed] + [template3]
│
├─ Compress final buffer with JSZip (DEFLATE level 9)
│
├─ Email compressed .docx to admin (Premier Energies) via Brevo
│
└─ Email confirmation to EPC_Email (if provided) via Brevo
```

---

## 13. DOCX Templates

| File | Used For | Key Placeholders |
|---|---|---|
| `template1.docx` | Cover page with first 50 serial numbers & form data | `{WARR_No}`, `{NO_ID}`, `{Serial_No1}` … `{Serial_No50}`, all other form field names |
| `template2.docx` | Overflow serial numbers (column-wise, multi-page) | `{#pages}` loop → `{#table}` loop → `{c0}` … `{c4}` |
| `template3.docx` | Site installation pictures | `{#images}` loop → `{%img}` (image tag) |
| `template.docx` | Legacy / not used in current code | — |

> Templates use **Docxtemplater** syntax: `{field}` for text, `{#loop}…{/loop}` for arrays, `{%image}` for images.

---

## 14. Firestore Collections & Schema

### `requests`
| Field | Type | Description |
|---|---|---|
| `warrantyCertificateNo` | `string` | Same as the document ID (e.g. `WR_1677`) |
| `status` | `string` | `"pending"` \| `"approved"` \| `"rejected"` |
| `serialNumbers` | `array<string>` | List of module serial numbers |
| `sitePictures` | `array<string>` | URLs of site installation photos |
| `EPC_Email` | `string` | Contact email of the EPC company |
| `EPC_Per` | `string` | Contact person name |
| `WARR_No` | `string` | Warranty certificate number displayed in emails |
| `createdAt` | `Timestamp` | Server-set creation timestamp |
| `updatedAt` | `Timestamp` | Server-set last-updated timestamp |
| *(other form fields)* | various | Any additional fields submitted by the form |

### `admin_logs`
| Field | Type | Description |
|---|---|---|
| `adminEmail` | `string` | Email of the admin who performed the action |
| `action` | `string` | Human-readable description of the action |
| `details` | `object` | Arbitrary additional context |
| `timestamp` | `Timestamp` | Server-set timestamp |

### `counters`
| Document | Field | Description |
|---|---|---|
| `warranty_cert` | `currentValue` (number) | Last used numeric ID; next ID = `currentValue + 1` |

---

## 15. Error Handling Strategy

| Layer | Strategy |
|---|---|
| Auth errors | Immediate `401` / `403` response from `verifyToken` middleware |
| Email errors | Wrapped in inner `try/catch`; logged to console; **do not** fail the outer request |
| Firestore errors | Caught and returned as `500` with `error.message` |
| Document generation errors | Caught and returned as `500` with details |
| Counter collision | Retried up to 10 times inside a transaction before failing with a descriptive error |

---

## 16. How to Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with required variables (see Section 4)

# 3. Start the server
node index.js
# Server runs at http://localhost:5000
```

> There is no `npm start` or `npm run dev` script defined. Run directly with `node index.js`.

**Testing the health check:**
```
GET http://localhost:5000/
→ "I am alive"
```

---

## 17. Deployment Notes

- **Platform:** Render (inferred from allowed origins and environment)
- **Port:** `5000` (hardcoded in `app.listen`)
- **Firebase Admin Auth:** Requires Application Default Credentials on the deployment environment. On Render, set `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service account JSON, OR use Render's managed identity.
- **Template files:** `template1.docx`, `template2.docx`, `template3.docx` must be co-located with `index.js` in the deployed container (they are read synchronously via `fs.readFileSync`).
- **Memory:** Large serial number lists + image fetching can be memory-intensive. Monitor heap usage under load.

---

## 18. Allowed Origins (CORS)

```
http://localhost:5173          ← Vite dev server (local)
http://localhost:3000          ← Next.js dev server (local)
https://ninja-penguin.vercel.app
https://ninja-penguin-backend-1.onrender.com
https://aura-self-six.vercel.app
https://pe-warranty-form.vercel.app
https://pe-warranty-dashboard.vercel.app
```

To add a new allowed origin, append it to the `allowedOrigins` array in `index.js` (lines 31–39).

