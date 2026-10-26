# ClipFetch — Social Media Video Downloader

> **Tagline**: Download Videos. Simply.  
> Fast, clean, and secure web application to check available video details and download public media from **Facebook**, **Instagram**, and **X (Twitter)** with multiple format and quality options.

---

## 🚀 Live Demo & Overview

ClipFetch is an enterprise-grade full-stack utility designed with zero clutter, zero fake statistics, and strict security controls against SSRF, command injection, and unauthorized network access.

### Key Features
- **Strict Hostname & SSRF Protection**: Validates target domains against whitelists, parses URLs with standard parsers, verifies DNS records, and denies private/cloud metadata ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, `::1`).
- **Real Platform Adapters**: Decoupled adapters for Facebook, Instagram, and X/Twitter using oEmbed, syndication APIs, and OpenGraph metadata inspection.
- **Genuine Format Options**: Dynamic extraction of MP4 video formats (1080p Full HD, 720p HD, 480p, 360p) with bitrates, resolutions, and calculated file sizes.
- **Safe Streaming Download Pipeline**: Direct streaming proxy with sanitized `Content-Disposition` filenames (`ClipFetch_<title>.mp4`), `Content-Length` enforcement, and file size limits (default 150 MB).
- **Per-IP Rate Limiting**: Sliding window rate limiter to protect against automated scraping and abuse.
- **Modern Responsive Design**: Mobile-first layout, dark/light theme toggle, keyboard navigation, accessible ARIA attributes, and clipboard paste helper.
- **Compliance & Legal Readiness**: Embedded Privacy Policy, Terms of Service, DMCA Copyright Takedown Contact, and AdSense-ready ad slots.

---

## 📁 Repository Structure

```
clipfetch/
├── server/
│   ├── src/
│   │   ├── middleware/
│   │   │   ├── errorHandler.ts       # Structured error response formatter
│   │   │   └── rateLimiter.ts        # In-memory per-IP token rate limiter
│   │   ├── routes/
│   │   │   └── apiRoutes.ts          # /api/health, /api/video/info, /api/video/download, /api/video/stream
│   │   ├── services/
│   │   │   ├── adapters/
│   │   │   │   ├── AdapterRegistry.ts  # Registry resolving adapters by platform
│   │   │   │   ├── FacebookAdapter.ts  # Facebook Watch, Reels, & posts
│   │   │   │   ├── InstagramAdapter.ts # Instagram Reels, posts, & IGTV
│   │   │   │   ├── PlatformAdapter.ts  # Common TypeScript adapter interface
│   │   │   │   └── XAdapter.ts         # X/Twitter syndication & MP4 variants
│   │   │   ├── downloadService.ts    # Streaming pipe, filename sanitization, size limit
│   │   │   └── videoService.ts       # Validation coordinator
│   │   ├── types/
│   │   │   └── index.ts              # Server TypeScript interfaces
│   │   ├── utils/
│   │   │   └── ssrfGuard.ts          # DNS & IP check, lookalike domain rejection
│   │   ├── validators/
│   │   │   └── videoValidator.ts     # Zod request payload schemas
│   │   └── app.ts                    # Express application factory with Helmet & CORS
│   └── tests/
│       └── securityAndValidation.test.ts # Vitest automated test suite (20 tests)
├── src/
│   ├── components/
│   │   ├── AdContainer.tsx           # AdSense-ready layout slot
│   │   ├── FaqSection.tsx            # Accessible accordion FAQ
│   │   ├── Footer.tsx                # Brand, legal notices, disclaimers
│   │   ├── Header.tsx                # 3-zone header, nav, dark mode toggle
│   │   ├── Hero.tsx                  # Large input, clipboard API, trust badges
│   │   ├── HowItWorks.tsx            # 3-step workflow
│   │   ├── LegalModals.tsx           # Privacy, Terms of Service, DMCA notice
│   │   ├── ResultCard.tsx            # Video preview, format selector, download trigger
│   │   └── SupportedPlatforms.tsx    # Facebook, Instagram, X platform guide
│   ├── services/
│   │   └── api.ts                    # Frontend API client
│   ├── types/
│   │   └── index.ts                  # Client types
│   ├── App.tsx                       # Main application view
│   ├── index.css                     # Tailwind CSS & Plus Jakarta Sans
│   └── main.tsx                      # React root entry point
├── public/
│   ├── robots.txt                    # Search crawler policy
│   └── sitemap.xml                   # XML sitemap
├── server.ts                         # Dev & production full-stack server
├── index.html                        # HTML entry point with meta tags & fonts
├── metadata.json                     # AI Studio metadata
├── package.json                      # Scripts & dependencies
├── tsconfig.json                     # TypeScript configuration
├── vite.config.ts                    # Vite build configuration
└── .env.example                      # Environment variables template
```

---

## 🛠️ Local Installation & Development

### Prerequisites
- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

### Steps
1. Clone repository:
   ```bash
   git clone https://github.com/your-username/clipfetch.git
   cd clipfetch
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. Run automated tests:
   ```bash
   npm run test
   ```

6. Run TypeScript lint check:
   ```bash
   npm run lint
   ```

---

## 🌐 Deployment Instructions

ClipFetch is built to support both unified full-stack deployments (e.g. Render, Railway, or VPS) and decoupled static frontend + Node.js API deployments.

### Option A: Free Full-Stack Deployment on Render
1. Create a free account at [render.com](https://render.com).
2. Connect your GitHub repository.
3. Select **New Web Service**:
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
   - **Plan**: Free
4. Add Environment Variables:
   - `PORT=3000`
   - `NODE_ENV=production`
   - `MAX_DOWNLOAD_SIZE_MB=150`
   - `DOWNLOAD_TIMEOUT_SECONDS=60`
5. Deploy! Render will build the Vite frontend into `dist/` and start Express to serve both `/api` endpoints and static frontend assets.

### Option B: Decoupled Deployment (Vercel Frontend + Render Backend)
1. Deploy the backend to Render using `node server.ts`.
2. On your static host (e.g., Vercel, Cloudflare Pages, Netlify), set:
   ```
   VITE_API_BASE_URL=https://your-backend-service.onrender.com
   ```
3. Update `CLIENT_ORIGIN` on the backend service to allow your frontend domain for CORS.

---

## 🔒 Security Architecture

| Threat | Mitigation |
| :--- | :--- |
| **SSRF (Server-Side Request Forgery)** | Strict hostname whitelist, DNS resolution check, blocks loopback (`127.0.0.1`), private RFC1918 subnets, and cloud metadata (`169.254.169.254`). |
| **Command Injection** | Zero shell interpolation. No user input is ever passed to shell commands. |
| **Lookalike Domains** | Substring and exact host checks reject `facebook.com.malicious.com`. |
| **Denial of Service** | Per-IP sliding window rate limiting and 150 MB maximum stream size threshold. |
| **Malicious Filenames** | Strips directory traversal (`../`) and non-alphanumeric characters from `Content-Disposition`. |
| **Information Disclosure** | Production error handler suppresses internal server traces and file paths. |

---

## ⚖️ Legal & Compliance
ClipFetch is intended exclusively for downloading publicly accessible media that the user owns or is authorized to download. ClipFetch respects access controls and does not bypass passwords, DRM, or private accounts.
