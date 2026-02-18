# GA4 Inspector API Integration Instructions

Use this guide to send requests from your app and receive the final PDF report.

## 1) Endpoint

- Local: `http://localhost:3001/api/v1/ga4-inspector/reports`
- Production (through your tunnel/domain): `https://api.blastgroup.org/api/v1/ga4-inspector/reports`

Health check:

- `GET /api/health`
- Expected response: `{ "ok": true }`

## 2) Required Request Format

- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `Accept: application/pdf`
- Body (JSON):
  - `events`: array (required)
  - `generatedAt`: ISO datetime string (required)
  - `source`: must be `"extension"` (required)
  - `sessionInfo`: object (optional)

## 3) Working Example Payload

```json
{
  "events": [
    {
      "id": "e1",
      "timestamp": "2025-02-12T14:30:00.000Z",
      "eventName": "page_view",
      "measurementId": "G-XXXXXXXX",
      "pageUrl": "https://example.com/page",
      "params": {
        "page_location": "https://example.com/page",
        "page_title": "Example Page",
        "client_id": "123.456",
        "session_id": "789"
      },
      "source": "collect"
    }
  ],
  "sessionInfo": {
    "pageUrl": "https://example.com/page",
    "userAgent": "Mozilla/5.0 ..."
  },
  "generatedAt": "2025-02-12T14:35:00.000Z",
  "source": "extension"
}
```

## 4) cURL Test (Saves PDF)

```bash
curl -X POST "https://api.blastgroup.org/api/v1/ga4-inspector/reports" \
  -H "Content-Type: application/json" \
  -H "Accept: application/pdf" \
  --data @payload.json \
  --output ga4-inspector-report.pdf
```

## 5) Browser App Example (JavaScript)

```js
async function exportGa4Pdf(payload) {
  const res = await fetch("https://api.blastgroup.org/api/v1/ga4-inspector/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/pdf"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const errorBody = isJson ? await res.json() : await res.text();
    throw new Error(`PDF request failed (${res.status}): ${JSON.stringify(errorBody)}`);
  }

  const blob = await res.blob();
  const filename = getFilenameFromContentDisposition(
    res.headers.get("content-disposition")
  ) || "ga4-inspector-report.pdf";

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getFilenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  return match ? match[1] : null;
}
```

## 6) Node.js Server-to-Server Example

```js
import fs from "node:fs/promises";

async function requestGa4Pdf(payload) {
  const res = await fetch("https://api.blastgroup.org/api/v1/ga4-inspector/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/pdf"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed (${res.status}): ${text}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  await fs.writeFile("ga4-inspector-report.pdf", bytes);
}
```

## 7) Expected Errors

- `400` invalid body
- `413` payload > 5MB
- `429` too many requests
- `500` internal PDF generation error

All errors return JSON.

## 8) Notes for Your Dev

- `source` must always be exactly `"extension"`.
- Keep payload below 5MB.
- Send `Accept: application/pdf` so the backend returns the binary PDF.
- Read the response as binary (`blob`/`arrayBuffer`) and store/download it as `.pdf`.
- Legacy route alias currently still works during migration: `/api/v1/reports/ga4-inspector`.
