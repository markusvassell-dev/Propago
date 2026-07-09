# nexus-generator (Replit app)

The external content generator NexusFlow calls instead of OpenAI directly
(`ReplitGenerationAdapter`). Receives `{ topic, keywords, tone, brandVoice, revisionNote }`,
returns a 1000+ word blog post in Markdown plus a publicly hosted lead-magnet PDF.

## Deploy on Replit

1. **replit.com → Create App → Node.js**, then drag these 4 files into the file tree
   (replace the template's `index.js`/`package.json`). Replit installs deps automatically;
   if not, run `npm install` in the Shell.
2. **Tools → Secrets**, add:
   - `OPENAI_API_KEY` — your OpenAI key (this app owns blog generation; the Railway side
     only uses OpenAI for distribution copy)
   - `REPLIT_SERVICE_SECRET` — a long random string, e.g. `openssl rand -hex 32`.
     **Must be identical to the `REPLIT_SERVICE_SECRET` variable on Railway.**
   - `OPENAI_MODEL` — optional, defaults to `gpt-4o`
3. Press **Run** and smoke-test from the Shell (see below).
4. **Deploy → Autoscale** (defaults are fine). Copy the public URL, e.g.
   `https://nexus-generator-yourname.replit.app`.

## Point Railway at it

In the NexusFlow service variables:

- `REPLIT_GENERATOR_APP_URL` = `https://<your-app>.replit.app/api/generate`
  ⚠ include the full `/api/generate` path — the backend POSTs to this URL verbatim.
- `REPLIT_SERVICE_SECRET` = the same secret as in Replit Secrets.

## Smoke test

```bash
curl -X POST https://<your-app>.replit.app/api/generate \
  -H "Authorization: Bearer $REPLIT_SERVICE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"topic":"Cash-flow planning for health & safety consultancies","keywords":["cash flow","H&S consultancy"],"tone":"practical","brandVoice":"Plain-spoken, UK English, no fluff."}'
```

Expect (after 30–60s): `{ blogTitle, metaDescription, blogMarkdown, leadMagnetUrl, leadMagnetName }`.
Open `leadMagnetUrl` in a browser to see the PDF. A `GET /` returns a health JSON.

## Notes

- First request after idle can take 60–90s (cold start) — the Railway adapter's timeout
  already allows for this. Don't lower `REPLIT_TIMEOUT_MS`.
- Bad/missing bearer → 401; generation failure → 502; the Railway side retries 3× with
  exponential backoff, then posts the "Workflow Failed" note to the Karbon timeline.
- **PDF durability:** magnets are written to the app's local disk. On Autoscale, disk is
  ephemeral — files can vanish on redeploy/scale-down, breaking previously published
  links. For durable links, deploy as a **Reserved VM** instead, or move `public/magnets`
  to Replit Object Storage / S3 later. Fine as-is while you're testing.
