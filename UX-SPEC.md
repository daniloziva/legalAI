# LegalAI — Complete UX/UI Design Specification

---

## 1. Page Layout and Flow

The entire app is a single vertical page with three visual zones stacked top to bottom. The user's workflow is strictly linear: upload, wait, review/download.

**Zone A — Header bar** (fixed height, 64px)
Left: LegalAI wordmark. Right: nothing for MVP (future: user avatar/logout).

**Zone B — Upload zone** (dominant when no results exist, shrinks after results appear)
A large drop zone centered on the page. This is the first and only thing the user sees on load.

**Zone C — Results zone** (hidden until results exist, then becomes the dominant area)
A split layout: left side is the results table with toolbar, right side is a PDF preview panel that opens when a row is clicked.

**Step-by-step user flow:**

1. User lands on the page. Sees the header and a large, inviting upload zone. Nothing else.
2. User drags PDFs onto the zone (or clicks to browse). File names appear in a compact list inside the zone with individual remove buttons.
3. User clicks "Pokreni ekstrakciju" (Start extraction). The upload zone collapses to a slim progress bar area. Each file shows its own status: uploading, processing, done, or failed.
4. As results come in, the results table populates row by row (or all at once, depending on backend). The upload zone remains collapsed at the top as a slim strip so the user can add more files later.
5. User clicks a row to review — the PDF preview panel slides in from the right, showing the original scanned document side-by-side with the extracted fields. Low-confidence and missing fields are highlighted, prompting manual review.
6. User edits fields inline while viewing the original document, then clicks "Preuzmi Excel" (Download Excel).

---

## 2. Component Breakdown (10 components)

```
src/
  App.jsx                    — Layout shell, state orchestration
  components/
    Header.jsx               — Top bar with logo
    UploadZone.jsx            — Drag-and-drop area + file picker
    FileList.jsx              — List of selected/queued files with status
    FileListItem.jsx          — Single file row (name, size, status, remove)
    ProcessingBar.jsx         — Overall batch progress indicator
    ResultsToolbar.jsx        — Summary count + Download Excel button
    ResultsTable.jsx          — The data table with inline editing
    PdfPreview.jsx            — Side panel with embedded PDF viewer + field summary
    StatusBadge.jsx           — Reusable badge for cell confidence / file status
```

That is 10 components including App. Each has a single responsibility.

---

## 3. Visual Design Direction

**Philosophy:** Law offices trust things that look like documents, not dashboards. The design borrows from the aesthetic of well-typeset legal paperwork — clean serif accents, generous whitespace, muted colors, sharp alignment.

**Color palette:**

| Role | Hex | Usage |
|---|---|---|
| Primary (ink) | `#1B2A4A` | Headers, primary text, logo |
| Primary hover | `#2A3F6B` | Button hover states |
| Surface | `#FFFFFF` | Page background, card backgrounds |
| Surface alt | `#F6F7F9` | Table striping, upload zone background |
| Border | `#D8DCE3` | Table borders, input borders, dividers |
| Accent | `#2E6FBA` | Primary buttons, links, active states |
| Accent hover | `#245A9A` | Button hover |
| Success | `#1A7D45` | Completed status, high confidence |
| Warning | `#C17A15` | Low confidence fields, partial results |
| Error | `#C0392B` | Failed extraction, validation errors |
| Text primary | `#1B2A4A` | Body text |
| Text secondary | `#6B7280` | Labels, captions, secondary info |

**Typography:**

- **Font stack:** `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Inter is the sole typeface. Professional, highly legible, free, and has excellent Cyrillic support (critical for Serbian text).
- **Scale:** 13px body / 14px table cells / 11px captions / 18px section headings / 20px page title
- **Weight:** 400 regular, 500 medium (labels, table headers), 600 semibold (buttons, headings)

**Spacing system:** 4px base unit. Use multiples: 8, 12, 16, 24, 32, 48. Maximum content width: 1120px, centered.

**Border radius:** 6px for cards and buttons. 4px for inputs and badges. 0px for the table.

**Shadows:** One shadow only, used on the upload zone card: `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`. The table uses borders, not shadows.

---

## 4. State Designs

### 4a. Empty State (initial load)

The upload zone occupies the vertical center of the viewport below the header. It is a large rounded rectangle (max 640px wide, ~320px tall), border: 2px dashed `#D8DCE3`, background `#F6F7F9`, centered horizontally.

Contents (all centered):
- Upload cloud icon (lucide `Upload` icon, 48px, color `#6B7280`)
- Primary text: **"Prevucite PDF dokumente ovde"** (Drag PDF documents here) — 16px, `#1B2A4A`, font-weight 500
- Secondary text: "ili" (or) — 13px, `#6B7280`
- Button: **"Izaberite fajlove"** (Choose files) — outlined style, `#2E6FBA` border and text, white background, 13px semibold
- Caption below: "PDF format, do 20MB po fajlu" — 11px, `#6B7280`

On drag hover: border becomes solid `#2E6FBA`, background becomes `#EBF2FB` (a very light blue wash). Transition: 150ms.

### 4b. Files Selected (pre-upload)

The upload zone shrinks vertically to accommodate a file list below the drop prompt. The file list appears inside the same card, separated by a thin `#D8DCE3` divider.

Each file row (FileListItem) shows:
- File icon (lucide `FileText`, 16px, `#6B7280`)
- File name (truncated with ellipsis at 40ch), 13px, `#1B2A4A`
- File size ("2.4 MB"), 13px, `#6B7280`
- Remove button (lucide `X`, 16px, `#6B7280`, hover `#C0392B`)

Below the file list, full-width inside the card:
- Primary action button: **"Pokreni ekstrakciju"** (Start extraction) — filled, `#2E6FBA` background, white text, 14px semibold, 40px height, full width of the file list area. This button only appears when at least one file is selected.

The user can still drag more files or click to add more. The file count shows in a subtle label: "3 dokumenta izabrana" (3 documents selected).

### 4c. Processing State

**Architecture note:** The backend uses a submit/poll pattern (`POST /api/extract` returns 202 with a batchId, `GET /api/extract/:batchId` returns current progress). The frontend polls every 2 seconds. This enables real per-file progress updates and supports cancellation.

The upload zone card collapses. It is replaced by a slim horizontal ProcessingBar component (full content width, 64px tall, white background, bottom border).

The ProcessingBar shows:
- Left: "Obrada u toku... 2 od 5 dokumenata" (Processing... 2 of 5 documents) — 14px, `#1B2A4A`
- Center-right: **"Otkaži"** (Cancel) link — `#C0392B` text, 13px. Triggers AbortController to stop polling and discard partial results.
- Below the text: a thin (4px) progress bar, `#F6F7F9` track, `#2E6FBA` fill, width = `(completed / total) * 100%`, smooth CSS transition

Below the ProcessingBar, the results table begins to appear (populated as each poll returns new completed results). If no results yet, show a centered spinner area with the text "Ekstrakcija podataka u toku..." and a simple CSS spinner (a rotating border, not a heavy library animation).

**Per-file progress from polling:** Each poll response includes the `completed` count and the `results` array so far. The FileList (rendered compactly below the progress bar) derives per-file status from the results array:
- File appears in results with fields: green checkmark + "Završeno"
- File appears in results with error: red X + "Greška"
- File not yet in results and index <= completed: gray dot + "Na čekanju"
- File not yet in results and index === completed: animated blue dot (pulsing opacity) + "Obrada..."

### 4d. Results Ready

The ProcessingBar shows "Obrada završena — 5 od 5 dokumenata" in green text, then after 3 seconds fades to a collapsed slim strip (32px) that just says "5 dokumenata obrađeno" with a "+ Dodaj nove" (Add new) link on the right that re-expands the upload zone.

The ResultsToolbar appears above the table:
- Left: "Rezultati ekstrakcije — 5 dokumenata" (14px, medium weight)
- Right: Download button (see section 7)

The ResultsTable takes over as the main content.

### 4e. Error States

**Full failure (single file):** That row in the results table shows a full-width cell spanning all columns with a light red background (`#FDF0EF`), the text "Ekstrakcija nije uspela za ovaj dokument" (Extraction failed for this document), and a "Pokušaj ponovo" (Retry) link in `#2E6FBA`. **Retry implementation:** the frontend re-submits just that single file to `POST /api/extract`, polls for the result, and merges it into the existing results array at the same index. No new backend endpoint needed.

**Partial results:** The row renders normally, but any field that could not be extracted shows an em-dash "—" in `#6B7280` italic, with a warning background (`#FFF8EB`) on that specific cell.

**Low confidence:** Cell text renders normally but with a small warning triangle icon (lucide `AlertTriangle`, 12px, `#C17A15`) to the left of the value, and the cell has a faint `#FFF8EB` background. Tooltip on hover: "Niska pouzdanost — proverite podatak" (Low confidence — verify this field).

**Network/server error (entire batch):** A banner appears below the ProcessingBar, full width, `#FDF0EF` background, `#C0392B` left border (4px), with the message and a retry button.

---

## 5. Upload Experience

**Drag and drop:**
- The entire upload zone card is the drop target.
- On `dragenter` of the zone: visual feedback (border and background change as described).
- Accept only `.pdf` files. If non-PDF files are dropped, show a transient toast-style message at the bottom of the upload zone: "Samo PDF fajlovi su podržani" — red text, fades after 3 seconds.
- Multiple files can be dropped at once.

**File picker:**
- The "Izaberite fajlove" button opens a native file picker with `accept=".pdf"` and `multiple`.
- Selected files are appended to the list (not replaced), so the user can pick in batches.

**Batch UX:**
- No upper limit in the UI, but a practical note in the caption if more than 20 files are selected: "Veliki broj fajlova — obrada može trajati duže" (Many files — processing may take longer).
- Each file can be individually removed before starting extraction.
- Once extraction starts, files cannot be removed (they are locked in).

**File validation (client-side):**
- Reject non-PDF immediately (never send to server).
- Reject files over 20MB with inline error on that FileListItem: "Fajl prevelik (maks. 20MB)" in `#C0392B`.
- Duplicate file names: allow them (different scans can share names).

---

## 6. Results Table

**Table structure:**

| # | Dokument | Broj predmeta | Ime stranke | JMBG | Ime klijenta | Status |

- Column 1 (#): Row number, 40px wide, right-aligned, `#6B7280`, 13px.
- Column 2 (Dokument): Original file name, truncated, 13px, `#1B2A4A`. On hover, show full name in native title tooltip.
- Columns 3-6: Extracted fields. 14px, `#1B2A4A`. These cells are **editable on click** — clicking a cell turns it into a text input (same size, no border shift, just a subtle `#2E6FBA` underline). Press Enter or click away to confirm. This lets users fix OCR mistakes before downloading.
- Column 7 (Status): A StatusBadge — "Završeno" (green), "Delimično" / Partial (amber), or "Greška" (red).

**Table styling:**
- Header row: `#F6F7F9` background, `#1B2A4A` text, 12px uppercase, letter-spacing 0.5px, font-weight 600. Sticky on scroll.
- Body rows: white background, 1px `#D8DCE3` bottom border. Hover: `#F6F7F9` background.
- No vertical borders between columns — only the horizontal row dividers. This keeps it clean.
- Row height: 48px.
- Table fills the full content width (1120px max).

**Confidence indicators:**
- High confidence (default): no special styling.
- Low confidence: amber cell background `#FFF8EB`, small `AlertTriangle` icon inline before the value.
- Missing/failed: em-dash, `#6B7280` italic, cell background `#FDF0EF`.

**Sorting:** Not needed for MVP. Files appear in upload order.

**Pagination:** Not needed for MVP. If more than ~50 rows, use native browser scroll with the sticky header. In practice, agencies will process 5-20 documents at a time.

---

## 7. PDF Preview Panel (Side-by-Side Review)

**Purpose:** When AI extraction has low confidence or missing fields, the user needs to see the original document to manually verify/correct. Instead of opening the PDF separately, they click a row and the original scan appears right next to the table.

**Layout:**
- When no row is selected: results table takes full content width (1120px).
- When a row is clicked: the layout splits — table compresses to ~55% width on the left, preview panel takes ~45% on the right. Smooth CSS transition (200ms).
- The preview panel has a fixed position (sticky) so it stays visible while the user scrolls the table.

**Preview panel structure (PdfPreview.jsx):**

Top bar (48px, `#F6F7F9` background, bottom border):
- Left: file name (truncated), 13px semibold, `#1B2A4A`
- Right: close button (lucide `X`, 20px, `#6B7280`, hover `#C0392B`)

PDF viewer area (fills remaining height):
- Uses native browser `<iframe>` with the object URL as `src` — zero dependencies, browsers handle PDF rendering natively.
- **Target browser: Chrome/Edge** (which law offices in Serbia overwhelmingly use). Firefox uses a separate PDF.js viewer that behaves differently in iframes. Safari on iOS does not render PDFs inline.
- Fallback for unsupported browsers: show a "Preuzmi PDF" (Download PDF) link instead of the iframe.
- The PDF is loaded from a temporary object URL created from the original uploaded File object (kept in memory, never persisted to server).
- **Object URL lifecycle:** URLs are created lazily (only when a row is selected) and revoked on deselect, row change, or reset to prevent memory leaks.

Field summary strip (below or overlaying the PDF, 120px):
- Shows the 4 extracted fields for the selected row in a compact horizontal layout.
- Low-confidence fields highlighted with amber background `#FFF8EB` and warning icon — these are the fields the user should focus on.
- Each field is editable inline here too (same behavior as the table — edits sync both ways).
- This strip acts as a "checklist" — the user scans the PDF, glances at the strip, and corrects what's wrong without scrolling back to the table.

**Auto-open behavior:**
- When results first load, if any row has a low-confidence or missing field, the first such row is auto-selected and the preview panel opens automatically. This nudges the user to review problem documents first.
- Rows with all high-confidence fields do not auto-open — the user can still click to verify if they want.

**Row highlight:**
- The selected row in the table gets a left border (3px solid `#2E6FBA`) and a light blue background (`#EBF2FB`) so it's clear which document is being previewed.

**Keyboard support (nice-to-have for MVP):**
- Arrow up/down to navigate between rows while the preview panel is open.
- Escape to close the preview panel.

**Responsive:**
- On tablet (<1024px): the preview panel becomes a bottom sheet (slides up from the bottom, takes 50% viewport height) instead of a side panel, since horizontal space is limited.

---

## 8. Excel Download

**Button placement:** In the ResultsToolbar, right-aligned. Only visible when at least one result row exists.

**Button design:**
- Filled button, `#1A7D45` background (green — distinct from the blue accent, signals "export/complete" action), white text.
- Icon: lucide `Download` (16px) to the left of the label.
- Label: **"Preuzmi Excel"** (Download Excel), 13px semibold.
- Height: 36px, padding 0 16px, border-radius 6px.
- Hover: darken to `#156B38`.

**Behavior:**
- On click, triggers the download immediately. No confirmation dialog.
- If some rows have errors, show a small confirmation: "2 dokumenta imaju greške i neće biti uključena. Nastavi?" — a simple browser `confirm()` dialog is fine for MVP.
- The downloaded file is named `LegalAI_Ekstrakcija_2026-04-18.xlsx` (with the current date).

---

## 9. Responsive Considerations

**Breakpoints:**
- Desktop (>1024px): Full layout as described, max-width 1120px centered with 32px side padding.
- Tablet (768-1024px): Same layout, content fills width with 24px side padding. Table scrolls horizontally if needed (with a subtle horizontal scroll indicator shadow on the right edge).
- Mobile (<768px): Not a priority. The upload zone stacks fine. The table gets a horizontal scroll wrapper. No layout changes needed — it just scrolls.

**Specific adaptations for tablet:**
- Upload zone max-width becomes 100% instead of 640px.
- ResultsToolbar stacks: summary text on top, download button below (full width).
- Table cells get a minimum width (Dokument: 160px, fields: 120px each) so they do not crush.

---

## 10. CSS Architecture

No component library. All styles in a single `app.css` file. The total CSS should be under 400 lines.

**CSS custom properties (define in `:root`):**

```css
:root {
  --color-primary: #1B2A4A;
  --color-primary-hover: #2A3F6B;
  --color-accent: #2E6FBA;
  --color-accent-hover: #245A9A;
  --color-success: #1A7D45;
  --color-success-hover: #156B38;
  --color-warning: #C17A15;
  --color-warning-bg: #FFF8EB;
  --color-error: #C0392B;
  --color-error-bg: #FDF0EF;
  --color-surface: #FFFFFF;
  --color-surface-alt: #F6F7F9;
  --color-border: #D8DCE3;
  --color-text: #1B2A4A;
  --color-text-secondary: #6B7280;
  --font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --radius-sm: 4px;
  --radius-md: 6px;
  --content-max-width: 1120px;
}
```

---

## 11. Summary: What Makes This Demo-Worthy

1. **Instant clarity.** A non-technical legal staffer sees a drop zone and knows exactly what to do. There is no sidebar, no navigation, no settings. One page, one job.

2. **Professional restraint.** The color palette, Inter typeface, and generous whitespace say "reliable tool," not "Silicon Valley experiment." The green download button is the only color pop — it draws the eye to the end goal.

3. **Visible progress.** During the 10-30 second processing window (the moment most likely to cause anxiety), the user sees per-file status updates and a progress bar. They know nothing is stuck.

4. **Editable results.** Inline editing before download means the user trusts the output — they can fix an OCR mistake without leaving the page or opening Excel. This is a significant selling point in demos.

5. **Minimal component count.** Nine components, one CSS file, no routing, no state library. This ships in days, not weeks.
