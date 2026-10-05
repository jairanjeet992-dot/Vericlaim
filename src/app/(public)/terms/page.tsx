import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowLeft, Scale, FileText } from 'lucide-react';

export default function TermsOfServicePage() {
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
          <ShieldAlert className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider block">
              [LAWYER-REVIEW MANDATORY NOTICE]
            </span>
            <span>
              This Terms of Service document is an architectural and regulatory template drafted for Indian insurance investigation SaaS operations. It must be formally reviewed and ratified by a licensed Indian advocate and Chartered Accountant before onboarding commercial third-party agencies.
            </span>
          </div>
        </div>

        <div className="border-b border-slate-800 pb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-3">
            <Scale className="h-6 w-6 text-emerald-400" />
            <span>Master Software-as-a-Service (SaaS) Agreement</span>
          </h1>
          <p className="text-xs text-slate-400 mt-2">
            Governing the use of Vericlaim Multi-Tenant Insurance Investigation Management Platform.
          </p>
        </div>

        <div className="space-y-6 text-xs text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              1. Multi-Tenant SaaS Architecture & Tenant Isolation
            </h2>
            <p>
              Vericlaim provides an isolated multi-tenant software-as-a-service platform for licensed insurance investigation agencies. Each subscribing agency (&quot;Customer&quot; or &quot;Agency&quot;) operates within an isolated cryptographic and relational partition enforced by PostgreSQL Row-Level Security (RLS). Under no circumstances shall staff, managers, or investigators of one agency access or view the records, cases, documents, or financial ledgers of another agency.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              2. Permitted Use & Professional Investigation Standards
            </h2>
            <p>
              The Customer represents and warrants that all investigation activities conducted through the platform comply with applicable Indian laws, IRDAI (Protection of Policyholders&apos; Interests) Regulations, and ethical field inquiry practices. The Customer is strictly prohibited from uploading fraudulent, forged, or unlawfully obtained surveillance materials.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              3. Cloudflare R2 Direct Evidence Architecture
            </h2>
            <p>
              All photographic, audio, and video evidence captured by investigators is uploaded directly from client applications to private Cloudflare R2 object storage via pre-signed URLs. Byte streams do not transit through application servers. Each uploaded artifact is verified via SHA-256 integrity checksums. The Customer retains full ownership and chain of custody over all uploaded digital evidence.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              4. Statutory GST Invoicing & Tax Ledger (CA-VERIFY)
            </h2>
            <p>
              The platform provides automated GST tax calculation (Intra-State CGST+SGST vs Inter-State IGST) based on agency and client branch state codes. Invoices issued through the system are immutable in accordance with Section 31 of the Central Goods and Services Tax (CGST) Act, 2017. Post-issuance adjustments must be executed strictly via sequential Credit or Debit Notes. Statutory tax rules are implemented as software calculation aids; the Customer remains solely responsible for final GST returns (GSTR-1, GSTR-3B) and TDS filings.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              5. Data Protection & DPDP Act 2023 Alignment
            </h2>
            <p>
              The Customer acts as a Data Fiduciary and Vericlaim operates as a Data Processor under the Digital Personal Data Protection (DPDP) Act, 2023. Personally Identifiable Information (Aadhaar, PAN, medical diagnoses, bank details) must be processed strictly for legitimate insurance claim verification purposes with verified consent or statutory authorization.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              6. Service Level Agreement & Disaster Recovery
            </h2>
            <p>
              Vericlaim maintains an automated disaster recovery protocol featuring nightly encrypted database snapshots archived to Cloudflare R2 with an intended Recovery Point Objective (RPO) of &lt; 24 hours and Recovery Time Objective (RTO) of &lt; 2 hours. Service availability targets 99.5% uptime excluding scheduled maintenance windows.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              7. Governing Law & Dispute Jurisdiction
            </h2>
            <p>
              This Agreement shall be governed by and construed in accordance with the laws of the Republic of India. Any legal dispute, arbitration, or proceeding arising out of or in connection with this Agreement shall be subject to the exclusive jurisdiction of the competent courts at Indore, Madhya Pradesh.
            </p>
          </section>
        </div>

        <div className="pt-6 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between items-center">
          <span>Vericlaim SaaS Platform • Enterprise Legal Template v1.0</span>
          <span>Status: PENDING LAWYER SIGN-OFF</span>
        </div>
      </div>
    </div>
  );
}
