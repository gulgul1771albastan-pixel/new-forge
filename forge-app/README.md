# Forge

A writing platform: real accounts, real posts (with images), real likes,
views, and comments — all shared live across every visitor.

## Stack
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (posts, users, likes, comments, views)
- **Image storage:** Cloudinary (persistent — survives redeploys)
- **Frontend:** the existing Forge single-page app, served as static files
  by the same Express server, talking to the backend over `/api/*`

## Project structure
```
forge-app/
  package.json
  .env.example        <- copy to .env locally, never commit .env
  server/
    index.js          <- Express app entry point
    db.js             <- Postgres connection + schema setup
    auth.js           <- JWT helpers
    upload.js         <- Cloudinary + multer config
    routes/
      auth.js          (signup, login, me)
      posts.js         (list/create/delete posts, like)
      comments.js      (list/create/delete comments)
  public/
    index.html         <- the Forge frontend (talks to /api/*)
```

## 1. Push this to GitHub

From inside the `forge-app` folder:
```
git init
git add .
git commit -m "Forge: live posts, images, likes, comments"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
If you already have a repo, just copy these files into it, commit, and push
as normal.

**Important:** `.env` is in `.gitignore` on purpose — never commit real
secrets (database URL, JWT secret, Cloudinary keys) to GitHub. You'll enter
those directly into Render's dashboard instead (step 3).

## 2. Create a Cloudinary account (free)
1. Go to https://cloudinary.com and sign up (free tier is enough).
2. On your Cloudinary dashboard, copy: **Cloud name**, **API Key**, **API Secret**.
   You'll paste these into Render in step 3.

## 3. Deploy on Render

### a) Create the database first
1. In the Render dashboard: **New +** → **PostgreSQL**.
2. Name it (e.g. `forge-db`), pick the free plan, create it.
3. Once it's up, copy the **Internal Database URL** shown on its page.

### b) Create the web service
1. **New +** → **Web Service**.
2. Connect your GitHub repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free is fine to start.
4. Under **Environment**, add these variables:
   - `DATABASE_URL` → paste the Internal Database URL from step (a)
   - `JWT_SECRET` → any long random string (generate one below)
   - `CLOUDINARY_CLOUD_NAME` → from Cloudinary
   - `CLOUDINARY_API_KEY` → from Cloudinary
   - `CLOUDINARY_API_SECRET` → from Cloudinary
5. Click **Create Web Service**. Render will install dependencies, run
   `npm start`, which also creates all database tables automatically on
   first boot (see `server/db.js`).
6. When the deploy finishes, Render gives you a live URL
   (e.g. `https://forge-app.onrender.com`) — that's your live site.

To generate a `JWT_SECRET` locally:
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 4. Using it
- Anyone who visits the URL can sign up, log in, and click **Start writing**
  to publish a post with an optional image.
- Every post is visible to every visitor immediately — likes, view counts,
  and comments update in the shared Postgres database, not just your browser.
- Only the post's author can delete their own post or their own comments.

## Notes / known limitations
- Render's **free** web service spins down after inactivity; the first
  request after a period of no traffic will be slow (~30s) while it wakes up.
  This does not lose any data — only the free Postgres and free web service
  are ephemeral in *compute*, not in stored data.
- Free Render Postgres databases expire after 90 days unless upgraded —
  Render will email you a warning before that happens.
- View counts count once per unique visitor per post per browser (rough,
  cookie-less anti-spam — not perfectly precise, but good enough to avoid a
  refresh spamming the number up).
