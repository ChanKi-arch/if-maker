# Deploy IF Maker

You need two URLs: one for the Next.js frontend and one for the FastAPI backend.

Recommended split:
- **Frontend** → Vercel (free tier)
- **Backend** → Railway (free tier, Docker-based)

Both free tiers are enough for a demo + moderate public traffic.

---

## 1. Deploy the backend to Railway

1. Push this repo to GitHub.
2. Go to <https://railway.app> → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects `backend/railway.json` and uses the Dockerfile.
4. Set the **Root Directory** to `backend`.
5. Add a **Public Domain** — Railway → your service → **Settings → Networking → Generate Domain**.
6. Note the URL — something like `https://if-maker-backend-production.up.railway.app`.

### Optional: enable LLM
Under the same service, **Variables** tab, add:
```
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini
LLM_TIMEOUT=15
```

Railway auto-restarts on variable changes.

### Verify
```bash
curl https://<your-railway-domain>/health
# → {"status":"ok"}
curl https://<your-railway-domain>/items/search | head -c 200
```

---

## 2. Deploy the frontend to Vercel

1. Go to <https://vercel.com> → **Add New → Project**.
2. Select the same GitHub repo.
3. **Root Directory**: `frontend`
4. **Framework Preset**: Next.js (auto-detected)
5. **Environment Variables**:
   ```
   NEXT_PUBLIC_API_BASE=https://<your-railway-domain>
   ```
6. Click **Deploy**.

Vercel gives you a URL like `https://if-maker.vercel.app`.

### Verify
Open <https://if-maker.vercel.app>. The header should show:
- Item count > 0
- `LAT` ticking
- `◉ sLLM` if you set the LLM env vars on Railway, `○ sLLM` otherwise

---

## 3. Enable CORS for your Vercel domain

The backend already has `allow_origins=["*"]` for quick start. For production, edit `backend/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://if-maker.vercel.app", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Commit → Railway auto-redeploys.

---

## 4. Smoke test

Run these after deploy:

```bash
BE=https://<your-railway-domain>

curl -s $BE/health
curl -s "$BE/items/search" | grep -o '"items":\[' | head -1
curl -s $BE/items/groups | python -m json.tool | head -10

curl -sX POST $BE/mix/generate \
  -H "Content-Type: application/json" \
  -d '{"item_ids":["chair","carbon_fiber"],"ratios":[0.6,0.4]}' \
  | python -c "import sys,json;r=json.load(sys.stdin);print(r['concept_name'])"
```

Expected: `"60% Carbon Fiber Chair"` or similar.

---

## 5. Custom domain (optional)

**Vercel**: Settings → Domains → Add. Point an A record or CNAME at Vercel's IP.

**Railway**: Settings → Networking → Custom Domain. Add a CNAME record.

---

## Troubleshooting

- **Frontend loads but no items** — `NEXT_PUBLIC_API_BASE` is wrong, or CORS on backend blocks the Vercel origin. Open browser devtools → Network → look at `/items/search` response.
- **Backend 502** — Railway service crashed. Check logs. Usually a missing env or Python version mismatch.
- **LLM offline in production** — `LLM_API_KEY` not set on Railway, or the model name doesn't exist on your provider.
- **Share links don't work** — they use `?c=<experiment_id>` which only loads if the backend still has that synthesis in memory. Synthesized items are registered at generate time and lost on backend restart. This is by design for v0 (no DB). v1.0 will persist.
