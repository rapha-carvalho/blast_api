# Mixpanel Inspector API Integration Instructions

Use this guide to send requests from your app and receive the final PDF report.

## 1) Endpoint

- Local: `http://localhost:3001/api/v1/mixpanel-inspector/reports`
- Production (through your tunnel/domain): `https://api.blastgroup.org/api/v1/mixpanel-inspector/reports`

Health check:

- `GET /api/health`
- Expected response: `{ "ok": true }`

## 2) Required Request Format

- Method: `POST`
- Headers:
  - `Content-Type: application/json`
  - `Accept: application/pdf`
- Body (JSON):
  - `events`: array (required, non-empty, max `10000`)
  - `generatedAt`: ISO datetime string (required)
  - `source`: must be `"extension"` (required)
  - `sessionInfo`: object (optional)

Notes:

- Unknown fields are ignored for forward compatibility.
- Keep payload below configured `MAX_BODY_MB` (default `5MB`).

## 3) Working Example Payload

```json
{
  "events": [
    {
      "id": "e1",
      "timestamp": "2026-02-20T20:00:00.000Z",
      "eventName": "Purchase",
      "projectToken": "abc123",
      "distinctId": "user-42",
      "sessionId": "sess-1",
      "measurementId": "abc123",
      "clientId": "user-42",
      "pageUrl": "https://example.com/checkout",
      "tabId": 123,
      "params": {
        "currency": "USD",
        "value": 29.9
      },
      "source": "network",
      "endpointType": "track",
      "warnings": [],
      "rawPayload": null
    }
  ],
  "sessionInfo": {
    "pageUrl": "https://example.com/checkout",
    "userAgent": "Mozilla/5.0 ..."
  },
  "generatedAt": "2026-02-20T20:00:01.000Z",
  "source": "extension"
}
```

## 4) cURL Test (Saves PDF)

```bash
curl -X POST "https://api.blastgroup.org/api/v1/mixpanel-inspector/reports" \
  -H "Content-Type: application/json" \
  -H "Accept: application/pdf" \
  --data @payload.json \
  --output mixpanel-inspector-report.pdf
```

## 5) Browser App Example (JavaScript)

```js
async function exportMixpanelPdf(payload) {
  const res = await fetch("https://api.blastgroup.org/api/v1/mixpanel-inspector/reports", {
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
  ) || "mixpanel-inspector-report.pdf";

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

async function requestMixpanelPdf(payload) {
  const res = await fetch("https://api.blastgroup.org/api/v1/mixpanel-inspector/reports", {
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
  await fs.writeFile("mixpanel-inspector-report.pdf", bytes);
}
```

## 7) Expected Errors

- `400` invalid body
- `413` payload too large
- `429` too many requests
- `500` internal PDF generation error

All errors return JSON:

```json
{
  "error": "Human readable message"
}
```

## 8) CORS

The backend supports extension/browser use with:

- Methods: `POST`, `OPTIONS`
- Headers: `Content-Type`, `Accept`

If using strict origin policy, include your extension origin:

- `chrome-extension://<EXTENSION_ID>`

## 9) Notes for Your Dev

- Always send `Accept: application/pdf`.
- Read response as binary (`blob`/`arrayBuffer`) and save as `.pdf`.
- Optional legacy alias: `/api/v1/reports/mixpanel-inspector`.
