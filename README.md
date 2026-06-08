# D&M Production Planner

A calendar-based production scheduler for D&M Design & Fabrication Ltd, with per-department
sequential scheduling, wait times, material due dates, and resource (men/machine) capacity.

## Run it on your computer

1. Install [Node.js](https://nodejs.org) (LTS version) if you don't have it.
2. Open a terminal in this folder and run:
   ```
   npm install
   npm run dev
   ```
3. Open the URL it prints (usually http://localhost:5173).

Your data is saved automatically in the browser (localStorage).

## Deploy to Vercel (free)

### Easiest — drag & drop via GitHub
1. Create a free account at [vercel.com](https://vercel.com) and [github.com](https://github.com).
2. Create a new GitHub repository and upload this whole folder to it
   (GitHub web: "Add file" → "Upload files" → drag everything in).
3. In Vercel: **Add New → Project → Import** your GitHub repo.
4. Vercel auto-detects Vite. Just click **Deploy**. Done — you'll get a live URL.

### Or via the Vercel CLI
1. Install the CLI: `npm i -g vercel`
2. In this folder run: `vercel`
3. Follow the prompts (accept the defaults). It deploys and gives you a URL.

## Notes
- The real D&M logo is in `public/dm-logo.png` and shows in the header.
- Working hours assume an 8-hour day (480 mins). Adjust per-day capacity by clicking
  any capacity badge on the calendar.
- Set the number of men/machines per department via the **Resources** button.
- Per-job resource overrides are in the job form (leave 0 to use 1 by default).
