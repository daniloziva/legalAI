# LegalAI -- Implementation Plan

MVP scope: single-page app that extracts structured data from scanned Serbian legal PDFs using Azure Document Intelligence OCR and Azure OpenAI GPT-4o. No auth, no database, no persistence. Process in memory, return results, discard.

---

## 1. Project Structure

```
legalAI/
  PLAN.md
  server/
    package.json
    .env.example
    src/
      index.js                  # Server startup + graceful shutdown
      app.js                    # Express setup (cors, multer, routes, error handler)
      config/
        env.js                  # Zod-validated environment variables
      middleware/
        requestLogger.js        # Pino + pino-http request logging
        errorHandler.js         # Structured JSON error responses
      routes/
        extract.routes.js       # POST /api/extract (upload + process)
        health.routes.js        # GET /api/health
      services/
        ocr.js                  # Azure Doc Intelligence: PDF buffer -> raw text
        extraction.js           # Azure OpenAI: raw text -> structured JSON
        excel.js                # ExcelJS: results array -> .xlsx buffer
      prompts/
        extract-v1.txt          # Version-controlled system prompt
      lib/
        jmbg.js                 # JMBG checksum validation
  client/
    package.json
    index.html
    vite.config.js
    src/
      main.jsx                  # React entry point
      App.jsx                   # Root component, all state lives here
      api.js                    # Axios instance + API calls
      components/
        Header.jsx              # Top bar with logo
        UploadZone.jsx          # Drag-and-drop / file picker for PDFs
        FileList.jsx            # List of selected/queued files with status
        FileListItem.jsx        # Single file row (name, size, status, remove)
        ProcessingBar.jsx       # Overall batch progress indicator
        ResultsToolbar.jsx      # Summary count + Download Excel button
        ResultsTable.jsx        # Editable table with confidence coloring
        PdfPreview.jsx          # Side panel: embedded PDF viewer + field summary strip
        StatusBadge.jsx         # Reusable badge for confidence / file status
      styles/
        app.css                 # All styles in one file
```

**Total: 25 files** (11 server, 14 client) excluding package.json/config files.

---

## 2. Backend Implementation

### 2.1 `server/src/config/env.js`

Zod-validated config. Crashes on startup if anything is missing.

```js
const envSchema = z.object({
  PORT:                        z.string().default('3001').transform(Number).pipe(z.number().int().positive()),
  NODE_ENV:                    z.enum(['development', 'production']).default('development'),
  CORS_ORIGIN:                 z.string().default('http://localhost:5173'),
  AZURE_DI_ENDPOINT:           z.string().url(),
  AZURE_DI_KEY:                z.string().min(1),
  AZURE_DI_API_VERSION:        z.string().default('2024-11-30'),
  AZURE_OPENAI_ENDPOINT:       z.string().url(),
  AZURE_OPENAI_KEY:            z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT:     z.string().min(1),
  AZURE_OPENAI_API_VERSION:    z.string().default('2024-12-01-preview'),
});
```

Exports: `{ env }` (frozen object).

### 2.2 `server/src/middleware/requestLogger.js`

Copy from DentaLink. Pino logger + pino-http middleware. Suppress `/api/health` from logs.

Exports: `{ logger, requestLogger }`.

### 2.3 `server/src/middleware/errorHandler.js`

Simplified from DentaLink (remove Telegram alerting). Structured JSON errors:

```json
{ "error": { "code": "INTERNAL_ERROR", "message": "...", "stack": "... (dev only)" } }
```

Exports: `{ errorHandler }`.

### 2.4 `server/src/app.js`

Express setup:

```js
const app = express();
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));    // only for export endpoint JSON body
app.use(requestLogger);
app.use('/api', healthRoutes);
app.use('/api', extractRoutes);
app.use(errorHandler);
```

Note: multer handles the multipart upload with its own size limits (20MB per file). The `express.json` limit is only for the `/api/export` endpoint which receives edited results as JSON — 2MB is generous for text-only field data.

No static file serving. Frontend is a separate deployable unit.

Exports: `app`.

### 2.5 `server/src/index.js`

```js
require('dotenv').config();
const app = require('./app');
const { env } = require('./config/env');
const { logger } = require('./middleware/requestLogger');

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'LegalAI server started');
});

// Graceful shutdown (SIGTERM, SIGINT)
```

### 2.6 `server/src/routes/health.routes.js`

```
GET /api/health  ->  { status: 'ok', timestamp: ISO string }
```

### 2.7 `server/src/routes/extract.routes.js`

Two-phase submit/poll pattern. This enables real per-file progress on the frontend and maps directly to a Durable Functions fan-out/fan-in pattern when migrating to Azure Functions later.

**In-memory job store** (Map keyed by batchId, no database):

```js
// Jobs stored in memory — acceptable for MVP (single server, no persistence needed)
const jobs = new Map(); // batchId -> { files: [...], results: [...], status: 'processing'|'complete' }
```

---

**Endpoint 1: Submit batch**

```
POST /api/extract
Content-Type: multipart/form-data
Body: files[] = one or more PDF files (field name: "files")

Response 202:
{
  "batchId": "abc123",
  "fileCount": 5,
  "status": "processing"
}
```

Route handler logic:
```
1. multer memoryStorage, accept up to 20 files, max 20MB each
2. Validate PDF in multer fileFilter (both checks required):
   - file.mimetype === 'application/pdf'
   - file.originalname.toLowerCase().endsWith('.pdf')
   Reject with 400 INVALID_FILE_TYPE if either check fails.
3. Generate batchId (crypto.randomUUID())
4. Store job in Map with initial state: { files, results: [], status: 'processing' }
5. Return 202 immediately
6. Process files sequentially in background (not awaited):
   a. ocr(file.buffer) -> ocrText
   b. extract(ocrText) -> { fields, tokenUsage }
   c. jmbg.validate(fields.jmbg.value) -> fields.jmbg.valid
   d. Push result (or error) to job.results
   e. After all files: job.status = 'complete'
```

---

**Endpoint 2: Poll for progress**

```
GET /api/extract/:batchId

Response 200 (while processing):
{
  "batchId": "abc123",
  "status": "processing",
  "total": 5,
  "completed": 2,
  "results": [
    {
      "filename": "document1.pdf",
      "fields": {
        "brojPredmeta":  { "value": "P1-123/2024", "confidence": "high" },
        "imeStranke":    { "value": "Петар Петровић", "confidence": "high" },
        "jmbg":          { "value": "0101990710123", "confidence": "medium", "valid": true },
        "imeKlijenta":   { "value": "Адвокат Марко Марковић", "confidence": "low" }
      },
      "tokenUsage": { "prompt": 1200, "completion": 80 }
    }
  ]
}

Response 200 (complete):
{
  "batchId": "abc123",
  "status": "complete",
  "total": 5,
  "completed": 5,
  "results": [ ... all 5 results ... ]
}

Response on per-file error (partial success — errors inline):
{
  "batchId": "abc123",
  "status": "complete",
  "total": 5,
  "completed": 5,
  "results": [
    { "filename": "document1.pdf", "error": "OCR failed: no readable text" },
    { "filename": "document2.pdf", "fields": { ... } }
  ]
}

Response 404: { "error": { "code": "BATCH_NOT_FOUND" } }
```

Jobs are cleaned up from the Map after 30 minutes (setTimeout on creation).

---

**Endpoint 3: Export to Excel**

```
POST /api/export
Content-Type: application/json
Body: { "results": [ { "filename": "...", "fields": { ... } } ] }
Body limit: 2mb (separate from multer upload limit)

Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (binary download)
Content-Disposition: attachment; filename="LegalAI_Ekstrakcija_{YYYY-MM-DD}.xlsx"
```

**Export request validation (zod):**

```js
const exportFieldSchema = z.object({
  value: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  valid: z.boolean().optional(),
});

const exportResultSchema = z.object({
  filename: z.string(),
  fields: z.object({
    brojPredmeta: exportFieldSchema,
    imeStranke: exportFieldSchema,
    jmbg: exportFieldSchema,
    imeKlijenta: exportFieldSchema,
  }),
});

const exportRequestSchema = z.object({
  results: z.array(exportResultSchema).min(1),
});
```

The export endpoint receives the (possibly edited) results from the frontend and returns the Excel file. This keeps extraction and export cleanly separated and lets the user edit fields before exporting.

### 2.8 `server/src/services/ocr.js`

Pure function: `async function ocr(pdfBuffer) -> string`

```
1. Convert buffer to base64
2. POST to Azure Doc Intelligence prebuilt-read:analyze
   URL: {endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version={version}
   Headers: Content-Type: application/json, Ocp-Apim-Subscription-Key: {key}
   Body: { base64Source: base64 }
3. Get operation-location from response headers
4. Poll operation-location every 2 seconds, max 30 attempts (60s timeout)
   - Status 'running' or 'notStarted': keep polling
   - Status 'succeeded': return analyzeResult.content
   - Status 'failed': throw with error details
5. If timeout: throw 'OCR timed out'
```

Exports: `{ ocr }`.

### 2.9 `server/src/services/extraction.js`

Pure function: `async function extract(ocrText) -> { fields, tokenUsage }`

```
1. Read system prompt from prompts/extract-v1.txt
2. POST to Azure OpenAI chat completions
   URL: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
   Headers: Content-Type: application/json, api-key: {key}
   Body: {
     messages: [
       { role: 'system', content: systemPrompt },
       { role: 'user', content: ocrText }
     ],
     temperature: 0,
     max_tokens: 500,
     response_format: { type: 'json_object' }
   }
3. Parse choices[0].message.content as JSON
4. Validate shape with zod (graceful -- if shape is wrong, return error)
5. Return { fields, tokenUsage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens } }
```

**Response validation schema (zod):**

```js
const fieldSchema = z.object({
  value: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

const extractionSchema = z.object({
  brojPredmeta: fieldSchema,
  imeStranke:   fieldSchema,
  jmbg:         fieldSchema,
  imeKlijenta:  fieldSchema,
});
```

The system prompt is loaded once at module init (fs.readFileSync) and cached. To deploy a new prompt version, change the filename reference.

Exports: `{ extract }`.

### 2.10 `server/src/services/excel.js`

Pure function: `async function generateExcel(results) -> Buffer`

Uses ExcelJS. See section 6 for column layout.

Exports: `{ generateExcel }`.

### 2.11 `server/src/lib/jmbg.js`

Pure function: `function validateJmbg(jmbg) -> { valid: boolean, reason?: string }`

See section 5 for the algorithm.

Exports: `{ validateJmbg }`.

### 2.12 `server/src/prompts/extract-v1.txt`

See section 4.

---

## 3. Frontend Implementation

### 3.1 Component Hierarchy

```
App
  Header                  (always visible, top bar with logo)
  UploadZone              (visible when no results or collapsed strip after results)
    FileList              (selected files with remove buttons, pre-upload)
      FileListItem        (single file: name, size, status, remove)
  ProcessingBar           (visible during extraction — overall progress)
  ResultsToolbar          (visible when results exist — summary + export button)
  ResultsLayout           (visible when results exist, split layout)
    ResultsTable          (left side — always visible when results exist)
      per-row: editable inputs for each field
      per-cell: StatusBadge (confidence coloring)
    PdfPreview            (right side — visible when a row is selected)
      embedded PDF via <iframe> (Chrome target, see note on cross-browser)
      field summary strip with inline editing
```

### 3.2 State Management

All state in `App.jsx` using `useState`. No context, no reducers, no external state library.

```js
const [results, setResults]       = useState(null);   // array of extraction results
const [files, setFiles]           = useState([]);      // original File objects (kept for PDF preview)
const [selectedRow, setSelectedRow] = useState(null);  // index of selected row (null = preview closed)
const [progress, setProgress]     = useState(null);    // { total, completed } from poll responses
const [loading, setLoading]       = useState(false);
const [error, setError]           = useState(null);
const [exporting, setExporting]   = useState(false);
const abortRef                    = useRef(null);      // AbortController for cancellation
```

**Cancellation:** On upload start, create `abortRef.current = new AbortController()` and pass `signal` to `extractDocuments()`. A "Cancel" button in the ProcessingBar calls `abortRef.current.abort()`.

**PDF preview object URLs:** Create object URLs lazily (only when a row is selected) and revoke them on deselect or reset. Store the active URL in a ref and call `URL.revokeObjectURL()` before creating a new one:

```js
const previewUrlRef = useRef(null);

function selectRow(index) {
  if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  previewUrlRef.current = index !== null ? URL.createObjectURL(files[index]) : null;
  setSelectedRow(index);
}

// Cleanup on reset/unmount
useEffect(() => {
  return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
}, []);
```

**Important:** The original `File` objects from the upload input must be kept in state. They are used to create object URLs for the PDF preview via `URL.createObjectURL(file)`. No server round-trip needed — the browser renders the PDF directly from memory.

### 3.3 `client/vite.config.js`

```js
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
```

### 3.4 `client/src/api.js`

```js
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
const POLL_INTERVAL = 2000; // 2 seconds

/**
 * Submit files for extraction. Returns batchId.
 */
export async function submitBatch(files) {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const { data } = await api.post('/extract', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data; // { batchId, fileCount, status }
}

/**
 * Poll for batch progress. Returns current state.
 */
export async function pollBatch(batchId) {
  const { data } = await api.get(`/extract/${batchId}`);
  return data; // { batchId, status, total, completed, results }
}

/**
 * Submit and poll until complete. Calls onProgress with each poll response.
 * Supports AbortController for cancellation.
 */
export async function extractDocuments(files, { onProgress, signal } = {}) {
  const batch = await submitBatch(files);
  const batchId = batch.batchId;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (signal?.aborted) return reject(new Error('Cancelled'));
      try {
        const status = await pollBatch(batchId);
        if (onProgress) onProgress(status);
        if (status.status === 'complete') return resolve(status.results);
        setTimeout(poll, POLL_INTERVAL);
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
}

/**
 * Export results to Excel. Returns Blob.
 */
export async function downloadExcel(results) {
  const { data } = await api.post('/export', { results }, {
    responseType: 'blob',
  });
  return data;
}
```

### 3.5 `client/src/App.jsx`

**User flow:**

1. **Initial state:** UploadZone visible, centered.
2. **User drops/selects PDFs:** calls `extractDocuments()` which submits then polls. Original File objects stored in state for preview. ProcessingBar appears with per-file progress ("Obrada u toku... 2 od 5 dokumenata"). Cancel button available.
3. **Results arrive:** UploadZone collapses, ResultsTable + ExportButton appear. Error results shown inline with red styling. If any row has low-confidence/missing fields, that row auto-selects and PdfPreview opens.
4. **User clicks a row:** PdfPreview panel slides in on the right (~45% width). Table compresses to ~55%. The original scanned PDF renders in an iframe. A field summary strip below the PDF highlights problem fields.
5. **User edits fields:** inline editing in ResultsTable or in the PdfPreview field strip (edits sync both ways). User can compare extracted values against the original scan.
6. **User clicks Export:** calls `downloadExcel()` with current (edited) state, triggers browser download.
7. **Close preview:** click X or press Escape. Table returns to full width.
8. **"Upload More" button:** resets state to initial.

### 3.6 `client/src/components/UploadZone.jsx`

Props: `{ onUpload, loading }`

- Drag-and-drop area with click-to-browse fallback.
- Accepts only `.pdf` files.
- Shows file count after selection, "Process" button to trigger.
- Shows spinner + progress text when `loading` is true.
- Uses `lucide-react` icons: `Upload`, `FileText`, `Loader2`.

### 3.7 `client/src/components/ResultsTable.jsx`

Props: `{ results, onUpdate }`

**Table columns:** #, Filename, Broj predmeta, Ime stranke, JMBG, Ime klijenta, Status

**Each data cell:**
- Editable `<input>` with current value.
- Small colored badge below showing confidence level.
- On change: calls `onUpdate(rowIndex, fieldName, newValue)` which updates App state.

**Confidence coloring (CSS classes):**
- `high` = green background badge (`#dcfce7`, border `#16a34a`)
- `medium` = yellow background badge (`#fef9c3`, border `#ca8a04`)
- `low` = red background badge (`#fee2e2`, border `#dc2626`)

**JMBG special handling:**
- If `valid === false`, show a small warning icon + "Invalid JMBG" text in red below the confidence badge.

**Error rows:** span full width, red background, show error message.

### 3.8 `client/src/components/ExportButton.jsx`

Props: `{ results, exporting }`

- Calls `downloadExcel(results)`, creates object URL, triggers download via hidden `<a>` click.
- Filename: `LegalAI_Ekstrakcija_{YYYY-MM-DD}.xlsx`
- Shows spinner while exporting.

### 3.9 `client/src/styles/app.css`

Single CSS file. Custom CSS, no component library. Key design decisions:

- System font stack, 14px base.
- Max-width 1200px centered container.
- Table with `border-collapse`, alternating row backgrounds.
- Inputs styled to look like table cells (borderless until hover/focus).
- Mobile: table scrolls horizontally.
- Upload zone: dashed 2px border, 200px min-height, centered icon + text.

---

## 4. System Prompt

File: `server/src/prompts/extract-v1.txt`

```
You are a legal document data extractor for Serbian court and legal documents.

You will receive OCR text extracted from a scanned document. The text is in Serbian (Cyrillic script). It may contain OCR errors, formatting artifacts, line breaks in unexpected places, and mixed Cyrillic/Latin characters.

Extract the following four fields from the document. For each field, provide the extracted value and a confidence level.

FIELDS:
1. brojPredmeta (case number) - The court case reference number. Usually formatted like "P1-123/2024", "K-45/23", "Posl.br. 1234/2024", or similar patterns with a letter prefix, numbers, and a year. Look near the top of the document, in headers, or after phrases like "Број предмета", "Посл.бр.", "Предмет број".

2. imeStranke (party name) - The full name of the main party. In civil cases, extract the plaintiff ("тужилац"). In criminal cases, extract the defendant ("окривљени"). If neither role is clear, extract the first named natural person who is not the legal representative. Look after phrases like "тужилац", "тужени", "окривљени", "подносилац", "странка", or in the header section of the document. If there are multiple parties with the same role (e.g., multiple co-plaintiffs), extract the first one listed. Return the full name as it appears (e.g., "Петар Петровић").

3. jmbg (personal identification number) - A 13-digit number. This is a Serbian Unique Master Citizen Number. Extract ONLY the JMBG of the main party (the person in imeStranke), NOT the JMBG of the legal representative or attorney. Look after "ЈМБГ", "Јединствени матични број", "матични број", or near personal identification sections. It is always exactly 13 digits. If you find a number that is close to 13 digits but not exactly, note that in the value and set confidence to low. If the document contains multiple JMBGs, select the one associated with the main party.

4. imeKlijenta (client name) - The name of the legal representative, attorney, or law firm. Look after "пуномоћник", "бранилац", "адвокат", "заступник", or law firm references. Return the full name (e.g., "адв. Марко Марковић" or "Адвокатска канцеларија Јовановић").

CONFIDENCE LEVELS:
- "high": The field was clearly found with an unambiguous label or in an expected location. OCR quality for this text appears good.
- "medium": The field was found but there is some ambiguity - e.g., multiple possible matches, the label is not explicit, or there are minor OCR artifacts.
- "low": The field value is a best guess. It was not clearly labeled, the OCR quality is poor in that region, or the value was inferred from context rather than directly found.

If a field cannot be found at all, set the value to an empty string and confidence to "low".

RESPONSE FORMAT:
Respond with a single JSON object. No other text, no markdown, no explanation.

{
  "brojPredmeta": { "value": "...", "confidence": "high|medium|low" },
  "imeStranke": { "value": "...", "confidence": "high|medium|low" },
  "jmbg": { "value": "...", "confidence": "high|medium|low" },
  "imeKlijenta": { "value": "...", "confidence": "high|medium|low" }
}
```

---

## 5. JMBG Validation

The JMBG (Jedinstveni Maticni Broj Gradjana) is a 13-digit Serbian personal identification number.

Format: `DDMMYYYRRBBBK`
- DD = day of birth (01-31)
- MM = month of birth (01-12)
- YYY = last 3 digits of birth year
- RR = region code (00-99)
- BBB = serial number (000-999), where 000-499 = male, 500-999 = female
- K = checksum digit

**Checksum algorithm:**

```
digits: d1 d2 d3 d4 d5 d6 d7 d8 d9 d10 d11 d12 d13

weights: 7 6 5 4 3 2 7 6 5 4 3 2

sum = d1*7 + d2*6 + d3*5 + d4*4 + d5*3 + d6*2 + d7*7 + d8*6 + d9*5 + d10*4 + d11*3 + d12*2

remainder = sum % 11

if remainder == 0: checkDigit = 0
if remainder == 1: JMBG is invalid (this combination is not assigned)
if remainder >= 2: checkDigit = 11 - remainder

Valid if d13 === checkDigit
```

**Implementation (`server/src/lib/jmbg.js`):**

```js
function validateJmbg(jmbg) {
  if (!jmbg || typeof jmbg !== 'string') return { valid: false, reason: 'Empty or not a string' };

  const cleaned = jmbg.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cleaned)) return { valid: false, reason: 'Must be exactly 13 digits' };

  const d = cleaned.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  const remainder = sum % 11;

  if (remainder === 1) return { valid: false, reason: 'Invalid checksum (remainder 1)' };

  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  if (d[12] !== checkDigit) return { valid: false, reason: `Checksum mismatch: expected ${checkDigit}, got ${d[12]}` };

  return { valid: true };
}
```

---

## 6. Excel Generation

**File:** `server/src/services/excel.js`

Uses ExcelJS workbook in memory (no temp files).

**Worksheet: "Extracted Data"**

| Column | Header              | Width | Source field           |
|--------|---------------------|-------|------------------------|
| A      | #                   | 5     | Row number             |
| B      | Fajl                | 30    | filename               |
| C      | Broj predmeta       | 20    | brojPredmeta.value     |
| D      | Ime stranke         | 30    | imeStranke.value       |
| E      | JMBG                | 18    | jmbg.value             |
| F      | JMBG validan        | 12    | jmbg.valid (Da/Ne)     |
| G      | Ime klijenta        | 30    | imeKlijenta.value      |

**Styling:**
- Header row: bold, dark blue background (`#1e3a5f`), white text, frozen.
- Data rows: alternating white / light gray (`#f3f4f6`).
- JMBG validan column: "Da" in green, "Ne" in red font color.
- All cells: border thin, font Calibri 11pt.
- Auto-filter on header row.

**Excel injection mitigation:** User-edited field values may start with `=`, `+`, `-`, or `@`, which some Excel versions interpret as formulas. Sanitize all field values before writing:

```js
function sanitizeForExcel(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) return "'" + value; // prefix with single quote
  return value;
}
```

**Generation:**

```js
async function generateExcel(results) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Extracted Data');
  // ... set up columns, header styles, iterate results (sanitize field values), style rows
  return workbook.xlsx.writeBuffer();
}
```

Returns a `Buffer` that the route handler sends as a file download with appropriate headers:
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="legalai-export-2026-04-18.xlsx"
```

---

## 7. Error Handling

### Backend Errors

| Step | What can go wrong | Handling |
|------|-------------------|----------|
| Upload | No files provided | 400 `{ error: { code: 'NO_FILES', message: 'At least one PDF file is required' } }` |
| Upload | File too large (>20MB) | 400, multer limits config handles this |
| Upload | Non-PDF file | 400 `{ error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF files are accepted' } }` |
| OCR | Azure DI returns 429 | Retry once after 5s, then fail the individual file |
| OCR | Azure DI returns 400 (corrupt PDF) | Mark file as errored in results, continue batch |
| OCR | Poll timeout (60s) | Mark file as errored, continue batch |
| OCR | Empty text returned | Mark file as errored ("No readable text found") |
| Extraction | Azure OpenAI returns 429 | Retry once after 5s, then fail the individual file |
| Extraction | GPT returns invalid JSON | Mark file as errored ("Extraction failed: invalid response") |
| Extraction | GPT returns wrong shape | Zod parse fails, mark errored with details |
| Export | Invalid results payload | 400 validation error |
| General | Unhandled exception | errorHandler catches, returns 500 |

**Key principle:** batch operations return partial results. If 3 of 5 files succeed, the response includes 3 results and 2 errors. The HTTP status is still 200 (the request itself succeeded).

### Frontend Errors

| Scenario | Handling |
|----------|----------|
| Upload fails (network) | Show error banner at top, keep upload zone active |
| Upload fails (413 too large) | Show "Files too large" message |
| Timeout (5 min) | Show "Processing took too long, try fewer files" |
| Export fails | Show toast/banner, keep results visible |
| Individual file errors | Show inline in results table with red styling |

---

## 8. Environment Variables

**File:** `server/.env.example`

```env
# Server
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Azure Document Intelligence
AZURE_DI_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_DI_KEY=
AZURE_DI_API_VERSION=2024-11-30

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

No frontend env vars needed. The frontend talks only to its own backend via the Vite proxy (dev) or same-origin (prod).

---

## 9. Implementation Order

### Week 1: End-to-End Pipeline

**Day 1-2: Backend skeleton**
1. `mkdir server && npm init`, install deps: `express axios multer pino pino-http exceljs zod cors dotenv`
2. `server/src/config/env.js` -- zod schema, validate on startup
3. `server/src/middleware/requestLogger.js` -- copy from DentaLink, strip DentaLink-specific bits
4. `server/src/middleware/errorHandler.js` -- copy from DentaLink, remove Telegram integration
5. `server/src/app.js` -- Express with cors, multer setup, health route
6. `server/src/index.js` -- startup + graceful shutdown
7. `server/src/routes/health.routes.js` -- verify server runs

**Day 2-3: OCR service**
8. `server/src/services/ocr.js` -- Azure Doc Intelligence integration
9. Test with a real scanned PDF via curl / Postman: `POST /api/extract` with a single file, log raw OCR text

**Day 3-4: Extraction service + prompt (CRITICAL — start testing with real docs here)**
10. `server/src/prompts/extract-v1.txt` -- write the system prompt
11. `server/src/services/extraction.js` -- Azure OpenAI call + zod validation
12. `server/src/lib/jmbg.js` -- checksum validation
13. Wire extraction into extract route, return full JSON response
14. **Test end-to-end with all 10 sample documents via curl.** Log extraction results, check accuracy on each field. Iterate on the prompt until accuracy is acceptable. Do NOT proceed to frontend until extraction quality is validated. The prompt is the product — this is the most important day of the entire build.

**Day 4-5: Frontend MVP**
15. `mkdir client && npm create vite@latest . -- --template react`, install deps: `axios lucide-react`
16. `client/vite.config.js` -- proxy setup
17. `client/src/api.js` -- submitBatch, pollBatch, extractDocuments (with AbortController), downloadExcel
18. `client/src/components/Header.jsx` -- top bar with logo
19. `client/src/components/UploadZone.jsx` -- file picker + drag-drop
20. `client/src/components/FileList.jsx` + `FileListItem.jsx` -- selected files with remove
21. `client/src/App.jsx` -- wire upload, polling, store results + files in state
22. `client/src/components/ResultsTable.jsx` -- display results, editable fields, StatusBadge
23. `client/src/components/StatusBadge.jsx` -- confidence/status coloring
24. `client/src/styles/app.css` -- all styling

**End of Week 1 milestone:** Upload a PDF in the browser, see extracted results in an editable table with confidence coloring.

### Week 2: Export + Preview + Polish

**Day 6-7: Excel export + progress bar**
25. `server/src/services/excel.js` -- ExcelJS generation with sanitizeForExcel()
26. `server/src/routes/export.routes.js` -- `/api/export` endpoint with Zod validation
27. `client/src/components/ResultsToolbar.jsx` -- summary + export button
28. `client/src/components/ProcessingBar.jsx` -- progress bar with cancel button

**Day 7-8: PDF Preview panel**
29. `client/src/components/PdfPreview.jsx` -- iframe viewer, field summary strip, object URL lifecycle
30. Split layout CSS (table 55% / preview 45%), row selection highlighting
31. Auto-open first problematic row on results load

**Day 8-9: Error handling + edge cases**
32. Handle partial failures (some files succeed, some fail)
33. Retry on failed rows (re-submit single file, merge result)
34. Handle empty OCR text gracefully
35. Handle GPT response validation failures
36. Frontend error states (network errors, timeouts, cancellation)
37. File type validation (reject non-PDFs in both frontend and backend — MIME + extension)

**Day 9-10: Polish**
38. Continue prompt tuning based on real document testing (started Day 3-4)
39. Improve table UX: tab between cells, visual feedback on edit, keyboard nav in preview
40. Add "Upload More" / reset flow with proper object URL cleanup
41. Final CSS pass (responsive, consistent spacing)

---

## Appendix: Package Dependencies

### Server (`server/package.json`)

```json
{
  "dependencies": {
    "express": "^4.21",
    "axios": "^1.7",
    "multer": "^1.4",
    "exceljs": "^4.4",
    "pino": "^9.6",
    "pino-http": "^10.4",
    "zod": "^3.24",
    "cors": "^2.8",
    "dotenv": "^16.4"
  }
}
```

### Client (`client/package.json`)

```json
{
  "dependencies": {
    "react": "^19.0",
    "react-dom": "^19.0",
    "axios": "^1.7",
    "lucide-react": "^0.460"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3",
    "vite": "^6.0"
  }
}
```
