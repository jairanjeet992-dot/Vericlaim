# Vericlaim: Production Deployment Guide

This guide details the complete, step-by-step process for deploying Vericlaim to the internet so that users (investigation agencies, managers, data entry staff, field investigators, and platform administrators) can access it securely from anywhere.

---

## 1. Architecture Overview

Vericlaim is built with an enterprise multi-tenant architecture:
- **Web & Application Tier**: Next.js App Router (TypeScript, Tailwind CSS, SSR/Edge Middleware).
  - Recommended Host: **Vercel** (fastest, zero-config serverless deployment) or **Docker / Coolify / Railway / VPS**.
- **Database & Identity Tier**: **Supabase** (Managed PostgreSQL with Row Level Security, Triggers, and Supabase Auth).
- **Object Storage Tier**: **Cloudflare R2** (Private S3-compatible storage for photos, video evidence, invoices, and payout statements; bytes never pass through the web server).
- **DNS & CDN**: **Cloudflare** (Fast global routing, SSL/TLS termination, DDoS protection).

```
   [User Browser / PWA Mobile]
               │
               ▼ HTTPS
      [Cloudflare CDN / DNS]
               │
      ┌────────┴────────┐
      │                 │ (Direct Pre-Signed PUT/GET)
      ▼                 ▼
[Next.js on Vercel]   [Cloudflare R2 Evidence Vault]
      │
      ▼ (PostgreSQL + RLS + JWT Auth)
[Supabase Managed Database]
```

---

## 2. Prerequisites

Before starting deployment, ensure you have accounts with:
1. **GitHub** (repository hosting & CI/CD workflows)
2. **Supabase** (https://supabase.com)
3. **Cloudflare** (https://cloudflare.com)
4. **Vercel** (https://vercel.com) - or a Linux VPS if self-hosting

---

## 3. Step 1: Database Setup (Supabase)

1. **Create Supabase Project**:
   - Go to [Supabase Dashboard](https://supabase.com/dashboard) and click **New Project**.
   - Name: `vericlaim-production` (or `vericlaim-staging`).
   - Region: Choose closest to your primary user base (e.g. `ap-south-1` Mumbai for Indian agencies).
   - Set a strong database password and save it securely.

2. **Run Database Migrations**:
   You can apply all migrations using the Supabase CLI or the SQL Editor in the Supabase Dashboard.
   In sequential order, execute the migrations from `supabase/migrations/`:
   - `00001_initial_tenancy_and_auth.sql`
   - `00002_rbac_and_scope.sql`
   - `00003_masters_and_pii.sql`
   - `00004_case_core_and_workflow.sql`
   - `00005_assignment_and_command_center.sql`
   - `00006_investigation_evidence_pwa.sql`
   - `00007_reports_review_rework_hardcopy.sql`
   - `00008_invoicing_gst_credit_notes.sql`
   - `00009_payments_tds_receivables_recovery.sql`
   - `00010_investigator_finance_payouts_sla_scorecard.sql`
   - `00011_global_search_reports_notifications.sql`
   - `00012_legacy_import_pipeline_and_parity.sql`
   - `00013_dpdp_compliance_and_governance.sql`

   *Tip:* If using the Supabase CLI locally:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. **Retrieve Supabase API Credentials**:
   - Navigate to **Project Settings** -> **API**:
     - **Project URL**: `https://<project-ref>.supabase.co`
     - **Project API Keys**:
       - `anon` `public`: Used as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
       - `service_role` `secret`: Used as `SUPABASE_SERVICE_ROLE_KEY` (Keep secret! Never expose to client).

---

## 4. Step 2: Storage Setup (Cloudflare R2)

Vericlaim uses Cloudflare R2 for zero-egress fee private evidence and PDF storage.

1. **Create R2 Buckets**:
   - In Cloudflare Dashboard, go to **R2 Object Storage**.
   - Create two buckets:
     1. `vericlaim-evidence-vault` (Primary bucket for evidence, reports, invoices)
     2. `vericlaim-production-backups` (Backup archive bucket)

2. **Configure CORS on `vericlaim-evidence-vault`**:
   - Go to bucket **Settings** -> **CORS Policy** and add:
   ```json
   [
     {
       "AllowedOrigins": [
         "https://yourdomain.com",
         "https://*.vercel.app",
         "http://localhost:3000"
       ],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **Generate R2 API Tokens**:
   - In Cloudflare R2, click **Manage R2 API Tokens** -> **Create API Token**.
   - Permissions: **Object Read & Write**.
   - Apply to: `vericlaim-evidence-vault` and `vericlaim-production-backups`.
   - Copy:
     - **Account ID** (`R2_ACCOUNT_ID`)
     - **Access Key ID** (`R2_ACCESS_KEY_ID`)
     - **Secret Access Key** (`R2_SECRET_ACCESS_KEY`)

---

## 5. Step 3: Web App Deployment (Vercel)

Vercel is the native platform for Next.js and provides automatic SSL, global CDN edge caching, and preview environments for pull requests.

1. **Connect Repository**:
   - Log in to [Vercel](https://vercel.com) and click **Add New...** -> **Project**.
   - Import your GitHub repository (`Vericlaim`).

2. **Configure Build Settings**:
   - Framework Preset: **Next.js**
   - Root Directory: `./`
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`

3. **Configure Environment Variables**:
   In Vercel Project Settings -> **Environment Variables**, add the following:

   | Variable Name | Value Description | Example |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://xyzcompany.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Public Anon Key | `eyJhbGciOi...` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secret Service Role Key | `eyJhbGciOi...` |
   | `AUTH_INTERNAL_DOMAIN` | Synthetic email domain | `auth.yourdomain.com` |
   | `R2_ACCOUNT_ID` | Cloudflare Account ID | `a1b2c3d4e5f6...` |
   | `R2_ACCESS_KEY_ID` | Cloudflare R2 Access Key | `0123456789abcdef...` |
   | `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Secret Key | `fedcba9876543210...` |
   | `R2_BUCKET_NAME` | Cloudflare Evidence Bucket | `vericlaim-evidence-vault` |
   | `NEXT_PUBLIC_APP_URL` | Canonical Production URL | `https://app.yourdomain.com` |

4. **Deploy**:
   - Click **Deploy**. Vercel will build and launch your application globally.

---

## 6. Step 4: Alternative Self-Hosted Deployment (Docker / VPS)

If you prefer self-hosting on an Ubuntu/Debian server or Docker container:

1. **Build Docker Image**:
   ```bash
   docker build -t vericlaim:latest .
   ```

2. **Run Container with Environment Variables**:
   ```bash
   docker run -d \
     --name vericlaim \
     -p 3000:3000 \
     --env-file .env.production \
     vericlaim:latest
   ```

3. **Nginx Reverse Proxy with Let's Encrypt SSL**:
   ```nginx
   server {
       server_name app.yourdomain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   Run `certbot --nginx -d app.yourdomain.com` to provision automatic HTTPS.

---

## 7. Step 5: Custom Domain & DNS Setup

1. In Vercel (or your host), add your custom domain: `app.yourdomain.com` or `yourdomain.com`.
2. In Cloudflare DNS (or your registrar), create the CNAME record:
   - Type: `CNAME`
   - Name: `app`
   - Target: `cname.vercel-dns.com`
   - Proxy status: **DNS only** (or Proxied if Full Strict SSL is configured).

---

## 8. Step 6: Initial System Bootstrap (First Agency & Admin)

Once the application is live:

1. **Verify Health Endpoint**:
   - Visit `https://app.yourdomain.com/api/health`.
   - Ensure the JSON response reports `"status": "healthy"`, `"database": "connected"`, and database query latency `< 100ms`.

2. **Provision Platform Super-Admin**:
   - Insert the platform owner's Supabase auth UUID into the `platform_admins` table:
   ```sql
   INSERT INTO public.platform_admins (id, email, full_name, is_active)
   VALUES ('<supabase-auth-user-uuid>', 'admin@yourdomain.com', 'Platform Admin', true);
   ```

3. **Provision First Agency (DNA Professional Investigation Agency)**:
   - Log in to the Super-Admin panel at `https://app.yourdomain.com/admin`.
   - Click **Create Agency**:
     - Name: `DNA Professional Investigation Agency`
     - Code: `DNA` (or `DNA01`)
     - State Code: `23` (Madhya Pradesh)
     - Plan: `Professional` or `Enterprise`
     - Initial Owner: Set username (`admin`) and temporary password.

4. **Verify Tenant Login**:
   - Go to `https://app.yourdomain.com/login`.
   - Enter:
     - Agency Code: `DNA`
     - Username: `admin`
     - Password: `<initial-password>`
   - Confirm successful redirection to the Command Center dashboard.

---

## 9. Step 7: Configure GitHub Actions Nightly Backups

To automate disaster recovery backups:
1. In your GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Add the following repository secrets:
   - `DATABASE_URL`: Your Supabase transaction pooler or direct connection URI (`postgres://postgres.[ref]:[password]@...:5432/postgres`)
   - `R2_ACCOUNT_ID`: Cloudflare account ID
   - `R2_ACCESS_KEY_ID`: Cloudflare R2 access key ID
   - `R2_SECRET_ACCESS_KEY`: Cloudflare R2 secret access key
   - `BACKUP_ENCRYPTION_PASSPHRASE`: A strong 32+ character passphrase for GPG AES-256 backup encryption
3. The workflow `.github/workflows/nightly-backup.yml` will automatically run every midnight (00:00 UTC / 05:30 IST) to encrypt and stream database dumps to R2.

---

## 10. Verification Checklist

- [ ] Health check returns 200 OK at `/api/health`.
- [ ] Security headers verified (Strict CSP, no third-party trackers, HSTS active).
- [ ] Agency login functions with synthetic email mapping (`u_<uuid>@auth...`).
- [ ] PWA manifest and service worker load cleanly on mobile devices.
- [ ] Evidence upload initiates and pre-signed PUT to R2 succeeds.
- [ ] Server-side invoice PDF generation succeeds.
- [ ] Restore drill (`npm run ts-node scripts/restore-drill.ts`) passes.
