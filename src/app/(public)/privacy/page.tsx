import React from 'react';
import Link from 'next/link';
import { ShieldCheck, ArrowLeft, Lock, FileText, AlertCircle } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-12 px-4 sm:px-6 lg:px-8 font-sans selection:bg-blue-600 selection:text-white">
      <div className="max-w-4xl mx-auto space-y-8">
        <Link
          href="/login"
          className="inline-flex items-center space-x-2 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Secure Login</span>
        </Link>

        {/* Lawyer Review Mandatory Notice */}
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider block">
              [LAWYER-REVIEW MANDATORY NOTICE]
            </span>
            <span>
              This Privacy Policy template has been constructed in strict conformance with the Digital Personal Data Protection (DPDP) Act, 2023. It must be formally vetted by a qualified Indian data privacy / cyber advocate prior to commercial production deployment.
            </span>
          </div>
        </div>

        <div className="border-b border-slate-800 pb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-3">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            <span>Digital Personal Data Protection & Privacy Policy</span>
          </h1>
          <p className="text-xs text-slate-400 mt-2">
            Governance, technical safeguards, and statutory data retention practices for Vericlaim SaaS.
          </p>
        </div>

        <div className="space-y-6 text-xs text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              1. Fiduciary Roles & Legal Scope
            </h2>
            <p>
              In the context of the DPDP Act 2023, the subscribing insurance investigation agency (&quot;Agency&quot;) acts as the <strong>Data Fiduciary</strong> determining the purpose and means of processing personal data relating to insurance policyholders, claimants, and hospital patients. Vericlaim acts strictly as a <strong>Data Processor</strong> providing enterprise cloud infrastructure, encryption, and relational tenancy isolation.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              2. Categories of Personal Data Processed
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li><strong>Identifiers:</strong> Insured / claimant name, policy number, claim number, contact telephone numbers.</li>
              <li><strong>Statutory Tax Data:</strong> Permanent Account Number (PAN) and GSTIN of clients and field investigators.</li>
              <li><strong>Medical & Health Data:</strong> Hospital admission records, discharge summaries, physician notes, and laboratory diagnostic reports uploaded as claim evidence.</li>
              <li><strong>Geographic Claimed Metadata:</strong> GPS coordinates, timestamps, and device EXIF metadata captured during field investigator visits.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              3. Technical Safeguards & Column-Level Encryption (Rule A7)
            </h2>
            <p>
              Vericlaim implements defense-in-depth security controls:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li><strong>PII Masking & Encryption:</strong> Sensitive PII (Aadhaar, PAN, phone numbers) is masked in default tabular views. Reveal actions are permanently logged in append-only audit tables.</li>
              <li><strong>HMAC Blind Indexing:</strong> Phone numbers and government IDs use deterministic blind indexes (HMAC-SHA256) for exact-match searches without exposing plaintext in database search indexes.</li>
              <li><strong>Zero App Server File Transit:</strong> Evidence files are uploaded directly to private Cloudflare R2 object storage via 10-minute pre-signed URLs, preventing file bytes from traversing serverless application memory.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              4. Statutory Retention Schedules vs. Erasure Requests
            </h2>
            <p>
              While Data Principals enjoy rights to correction and erasure under Section 12 of the DPDP Act, Section 17 provides statutory exemptions where retention is mandated by law:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li><strong>Tax Invoices & GST Ledgers:</strong> Mandatorily retained for a minimum of <strong>8 years (96 months)</strong> pursuant to Section 36 of the Central Goods and Services Tax (CGST) Act, 2017. Requests to delete issued invoices will be rejected with explicit statutory citation.</li>
              <li><strong>Investigation Case Files:</strong> Retained for the statutory limitation period governing insurance claims and litigation (typically 3 to 7 years).</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              5. Incident Reporting & Breach Protocol
            </h2>
            <p>
              In the event of a confirmed personal data breach affecting confidentiality or integrity:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>The incident is logged in the immutable <code className="font-mono-code text-slate-300">breach_logs</code> register.</li>
              <li>CERT-In is notified within <strong>6 hours</strong> of detection pursuant to Indian cyber incident reporting directives.</li>
              <li>The Data Protection Board of India and affected Data Principals are notified within <strong>72 hours</strong> in accordance with Section 8(6) of the DPDP Act.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              6. Grievance Redressal
            </h2>
            <p>
              Each subscribing agency must designate a Data Protection / Grievance Officer whose contact details are provided to data principals. Unresolved technical inquiries may be escalated to the Vericlaim Security &amp; Compliance Office.
            </p>
          </section>
        </div>

        <div className="pt-6 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between items-center">
          <span>Vericlaim SaaS Platform • DPDP Act 2023 Compliance Policy Template v1.0</span>
          <span>Status: PENDING ADVOCATE SIGN-OFF</span>
        </div>
      </div>
    </div>
  );
}
