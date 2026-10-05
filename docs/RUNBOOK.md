# Vericlaim Production Operations & Disaster Recovery Runbook

## 1. Disaster Recovery & Business Continuity

### 1.1 Key Service Targets
- **Recovery Point Objective (RPO):** &lt; 24 hours (nightly automated snapshots at 02:00 UTC / 07:30 IST).
- **Recovery Time Objective (RTO):** &lt; 2 hours to full restoration and service resumption.

### 1.2 Automated Backup Schedule
- **Engine:** GitHub Actions (`.github/workflows/nightly-backup.yml`) executing `pg_dump` with gzip compression.
- **Encryption:** GPG symmetric AES-256 encryption using secret passphrase.
- **Storage:** Private Cloudflare R2 bucket with statutory 8-year lifecycle retention policy.
- **Retention Lifecycle:**
  - Daily snapshots retained for 30 days.
  - Weekly snapshots retained for 12 weeks.
  - Monthly snapshots retained for 8 years (GST statutory audit requirement).

### 1.3 Step-by-Step Restoration Drill Procedure
To execute an emergency restore or scheduled drill:
1. **Retrieve Encrypted Snapshot:**
   ```bash
   aws s3 cp s3://vericlaim-backups/nightly/vericlaim_db_backup_LATEST.sql.gz.enc . \
     --endpoint-url $R2_ENDPOINT_URL
   ```
2. **Decrypt Archive:**
   ```bash
   gpg --batch --yes --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
     --decrypt vericlaim_db_backup_LATEST.sql.gz.enc > backup.sql.gz
   gunzip backup.sql.gz
   ```
3. **Verify Integrity & Checksum:**
   ```bash
   npx ts-node scripts/restore-drill.ts
   ```
4. **Restore Database:**
   ```bash
   psql "$TARGET_SUPABASE_DB_URL" < backup.sql
   ```
5. **Post-Restore Health Check:**
   ```bash
   curl -f https://app.vericlaim.in/api/health
   ```

---

## 2. Environment Separation & Configuration Architecture

| Environment | Purpose | Database | File Storage (R2) | Domain |
|---|---|---|---|---|
| **Development** | Local development & unit tests | Local / Vitest in-memory mocks | Local mock / Dev bucket | `localhost:3000` |
| **Staging** | Parallel run & parity validation | Supabase Staging (`tenant_1_staging`) | Cloudflare R2 Staging | `staging.vericlaim.in` |
| **Production** | Live tenant operations | Supabase Production (`ibsoxvwlvpytoalytqrt`) | Cloudflare R2 Production | `app.vericlaim.in` |

---

## 3. Monitoring, Uptime & Structured Health Probes

### 3.1 Health Check Endpoint
- **URL:** `GET /api/health`
- **Response Format:**
  ```json
  {
    "status": "HEALTHY",
    "version": "1.0.0-phase10-production",
    "timestamp": "2026-10-05T11:00:00.000Z",
    "uptime_seconds": 84210,
    "database": {
      "status": "CONNECTED",
      "latency_ms": 14
    },
    "environment": "production",
    "tenancy": "MULTI_TENANT_RLS_ISOLATION_ACTIVE"
  }
  ```
- **Alert Trigger:** Any HTTP 503 or latency &gt; 500ms triggers high-priority alert to DevOps on-call.

---

## 4. Secrets Management & Rotation Protocol

- **Zero Hardcoded Secrets (Rule A7):** All API keys, database URLs, and R2 credentials are injected via environment variables.
- **Rotation Frequency:**
  - Supabase Service Role Keys: Rotated every 90 days.
  - Cloudflare R2 Access Tokens: Rotated every 90 days.
  - Backup GPG Encryption Passphrase: Rotated every 180 days.
