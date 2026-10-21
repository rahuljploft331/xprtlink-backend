/** Seed: platform config + CMS stubs */
export const platformConfig = {
  commissionPercent: 15,
  maintenanceMode: false,
  supportEmail: "support@xpertlink.com",
  foundingMemberBadgeEnabled: true,
  currency: "USD",
};

export const cmsPages = [
  { 
    slug: "home", 
    title: "Homepage", 
    status: "published",
    bodyHtml: `<h1>Welcome to XprtLink</h1><p>The premier two-sided expert consultation marketplace.</p>`
  },
  { 
    slug: "privacy", 
    title: "Privacy Policy", 
    status: "published",
    bodyHtml: `<h1>Privacy Policy</h1><p>Your privacy is important to XprtLink. This document outlines how we handle customer and expert data, including messaging, video calls, and payment information.</p>`
  },
  { 
    slug: "terms", 
    title: "Terms of Service", 
    status: "published",
    bodyHtml: `<h1>Terms of Service</h1><p>By using the XprtLink platform as a Customer or Expert, you agree to our per-minute billing policies, manual call acceptance, and consultation terms.</p>`
  },
  { 
    slug: "contact", 
    title: "Contact", 
    status: "published",
    bodyHtml: `<h1>Contact Us</h1><p>Reach out to XprtLink support at support@xpertlink.com for help with your expert profile or consultation inquiries.</p>`
  },
  { 
    slug: "expert-standards", 
    title: "Expert Standards Agreement", 
    status: "published",
    bodyHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expert Standards Agreement – XprtLink</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    --green: #2e8f72;
    --green-btn: #3a9a7c;
    --text: #0a0a0a;
    --muted: #7b8088;
    --body: #6b6f76;
    --line: #dfe3e5;
    --mint: #eafaf5;
    --bg: #fafafa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #e9ecee; }
  body {
    font-family: 'Poppins', system-ui, -apple-system, sans-serif;
    color: var(--text);
    display: flex;
    justify-content: center;
    -webkit-font-smoothing: antialiased;
  }
  .screen {
    position: relative;
    width: 100%;
    max-width: 430px;
    min-height: 100vh;
    background: var(--bg);
    overflow: hidden;
    padding-bottom: 28px;
  }
  .screen::before {
    content: "";
    position: absolute;
    width: 340px; height: 240px;
    top: -70px; left: -90px;
    border-radius: 50%;
    background: rgba(46,156,122,.16);
    filter: blur(55px);
    pointer-events: none;
  }
  .content { position: relative; z-index: 1; padding: 0 22px; }

  header { display: flex; align-items: center; gap: 14px; padding-top: 26px; }
  .back {
    width: 36px; height: 36px;
    border: 0; border-radius: 12px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
    display: grid; place-items: center;
    cursor: pointer;
  }
  .back svg { width: 19px; height: 19px; }
  header h2 { font-size: 17px; font-weight: 500; }

  .hero { padding-top: 34px; }
  .hero h1 { font-size: 29px; font-weight: 500; line-height: 1.2; }
  .hero p {
    margin-top: 8px;
    font-size: 15px;
    line-height: 1.55;
    color: var(--muted);
  }
  .meta {
    margin-top: 26px;
    padding: 20px 0 8px;
    border-top: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 14px;
  }
  .meta div { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; }
  .meta svg { width: 18px; height: 18px; flex-shrink: 0; }

  .card {
    background: rgba(255,255,255,.85);
    border: 1px solid #eceff0;
    border-radius: 20px;
    padding: 22px 18px;
    margin-top: 16px;
    box-shadow: 0 1px 6px rgba(0,0,0,.03);
  }
  .card h3 { font-size: 19px; font-weight: 600; line-height: 1.4; }
  .card p {
    margin-top: 14px;
    font-size: 13.8px;
    line-height: 1.75;
    color: var(--body);
  }
  .card h3 + p { margin-top: 16px; }
  .card p.caps { text-transform: uppercase; }

  .quote {
    margin-top: 22px;
    background: var(--mint);
    border-radius: 14px;
    padding: 16px 14px;
    font-style: italic;
    font-size: 14.2px;
    line-height: 1.65;
    color: #2b2b2b;
  }

  .photo {
    margin-top: 16px;
    height: 200px;
    border-radius: 14px;
    overflow: hidden;
    position: relative;
    background:
      linear-gradient(115deg, rgba(20,40,60,.9) 0%, rgba(60,90,120,.75) 40%, rgba(120,150,175,.55) 70%, rgba(40,55,70,.9) 100%),
      #34495e;
  }
  .photo::before {
    content: "";
    position: absolute; inset: 0;
    background:
      repeating-linear-gradient(90deg, transparent 0 62px, rgba(0,0,0,.35) 62px 66px);
    opacity: .5;
  }
  .photo .doc {
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -48%) rotate(-3deg);
    width: 120px; height: 135px;
    background: rgba(255,255,255,.88);
    border-radius: 4px;
    padding: 10px 9px;
    box-shadow: 0 8px 20px rgba(0,0,0,.35);
  }
  .photo .doc b { display: block; font-size: 6.5px; color: #223; }
  .photo .doc small { display: block; font-size: 4.5px; color: #556; margin-top: 2px; }
  .photo .doc i {
    display: block; height: 2px; margin-top: 4px;
    background: #bbc2c8; border-radius: 1px;
  }

  .cta {
    margin-top: 12px;
    background: #e3f2ee;
    border-radius: 22px;
    padding: 30px 18px 22px;
    text-align: center;
    position: relative;
  }
  .cta h3 { font-size: 21px; font-weight: 600; line-height: 1.3; }
  .cta p { margin-top: 12px; font-size: 14px; line-height: 1.6; color: #2b2b2b; }
  .btn {
    display: block;
    width: 100%;
    margin-top: 20px;
    padding: 15px;
    border-radius: 14px;
    font: inherit;
    font-size: 14.5px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .btn.primary { background: var(--green-btn); color: #fff; border: 0; }
  .btn.ghost { margin-top: 12px; background: transparent; color: var(--green-btn); border: 1px solid #b7d9cf; }
</style>
</head>
<body>
<div class="screen">
  <div class="content">

    <div class="hero">
      <h1>Expert Standards Agreement</h1>
      <p>Welcome to the XprtLink Expert Network. As a verified consultant on our marketplace, you represent our highest benchmark of professional excellence. This Agreement outlines the operational, ethical, and service quality benchmarks required of all active Experts on XprtLink.</p>

      <div class="meta">
        <div>
          <svg viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          Last Updated: October 24, 2026
        </div>
        <div>
          <svg viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5M12 7v5l3 2"/></svg>
          Revision 3.1.0 • Standards &amp; Ethics
        </div>
      </div>
    </div>

    <article class="card">
      <h3>01. Identity Verification &amp; Credential Integrity</h3>
      <p>1.1. <strong>Authentic Credentials:</strong> Experts must provide true, complete, and verifiable biographical details, professional licenses, and industry experience. Any intentional misrepresentation of qualifications will lead to immediate profile termination.</p>
      <p>1.2. <strong>Document Validation:</strong> All Experts must complete mandatory identity verification by submitting a valid primary government-issued photo ID (and secondary identity documentation when requested). Verification badges are granted solely after administrative validation.</p>
      <p>1.3. <strong>Account Exclusivity:</strong> Your Expert profile is non-transferable. Consultations, in-app messaging, and quote responses must be conducted solely by the verified individual named on the account. Delegating sessions to unvetted third parties is strictly prohibited.</p>
      <div class="quote">"Trust is the cornerstone of XprtLink. Authentic credentials and verified identity protect both you and the clients who rely on your professional guidance."</div>
    </article>

    <article class="card">
      <h3>02. Professional Conduct &amp; Consultation Quality</h3>
      <p>2.1. <strong>Punctuality &amp; Schedule Accuracy:</strong> Experts must maintain an accurate calendar and real-time availability status. When you accept an instant consultation or a scheduled call, you must be present and prepared precisely at the designated start time.</p>
      <p>2.2. <strong>Environment &amp; Technical Requirements:</strong> Video consultations conducted via the platform must take place in a quiet, private, well-lit environment with high-speed internet and crystal-clear audio and video feeds. Consulting from moving vehicles or distracting public venues is unacceptable.</p>
      <p>2.3. <strong>Attendance &amp; Cancellation Policy:</strong> Failure to attend an accepted consultation without advance notice severely degrades client trust. Unexcused no-shows trigger immediate penalties, search ranking demotion, or account review.</p>
      <p>2.4. <strong>Empathy &amp; Respectful Engagement:</strong> Maintain the highest standards of decorum and courtesy. Profanity, discrimination, harassment, or abusive demeanor towards clients or platform staff results in immediate expulsion.</p>
    </article>

    <article class="card">
      <h3>03. In-App Video &amp; Messaging Standards</h3>
      <p>3.1. <strong>Integrated Video Consultations:</strong> All live video consultations must take place exclusively through XprtLink's integrated UIKit video interface. Calls are metered on a per-minute basis with ceiling round-up calculation.</p>
      <p>3.2. <strong>Text-Only In-App Messaging:</strong> Direct messaging within the platform is text-only to maintain focused, secure, and auditable communication. Messaging is intended for pre-consultation inquiries, scope clarification, and session scheduling.</p>
      <p>3.3. <strong>Prompt Response to Quote Requests:</strong> When clients submit custom Quote Requests with detailed requirements and media attachments, Experts are expected to provide prompt, fair, and transparent pricing proposals with defined deliverables.</p>
    </article>

    <div class="photo" role="img" aria-label="XprtLink Certified Expert Standards">
      <div class="doc">
        <b>XprtLink</b>
        <small>Expert Standards &amp; Code of Ethics</small>
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
    </div>

    <article class="card">
      <h3>04. Platform Integrity &amp; Anti-Circumvention</h3>
      <p class="caps">4.1. STRICT PROHIBITION OF OFF-PLATFORM TRANSACTIONS: ALL CONSULTATIONS, CLIENT COMMUNICATIONS, AND FINANCIAL SETTLEMENTS ORIGINATING ON XPRTLINK MUST REMAIN ON THE PLATFORM. EXPERTS MAY NOT SOLICIT, INVOICE, OR ACCEPT PAYMENTS OUTSIDE OF XPRTLINK.</p>
      <p>4.2. <strong>Anti-Disintermediation:</strong> Sharing direct payment coordinates (including personal bank accounts, PayPal, Venmo, CashApp, cryptocurrency addresses) or coaxing clients to off-platform channels to evade platform fees is a severe breach of contract. Violations result in permanent account termination, forfeiture of pending balances, and recovery of bypassed commission fees.</p>
      <p>4.3. <strong>Client &amp; Dispute Protection:</strong> Keeping interactions within XprtLink guarantees verified dispute mediation, secure escrow processing, and authentic marketplace review attribution.</p>
    </article>

    <article class="card">
      <h3>05. Pricing, Commission &amp; Payouts</h3>
      <p>5.1. <strong>Transparent Rates:</strong> Experts determine their per-minute and hourly consultation rates within marketplace thresholds. The displayed rate is comprehensive; charging surcharges or requesting extra off-platform payments is strictly barred.</p>
      <p>5.2. <strong>Platform Commission:</strong> The standard platform commission (15%) is automatically deducted from gross consultation earnings upon completion of the session to cover payment processing, video infrastructure, security, and marketplace maintenance.</p>
      <p>5.3. <strong>Payouts Settlement:</strong> Net earnings are distributed to your verified bank or payout account on the standard platform settlement schedule, subject to completed identity verification.</p>
    </article>

    <article class="card">
      <h3>06. Confidentiality &amp; Client Data Security</h3>
      <p>6.1. <strong>Strict Non-Disclosure:</strong> All project files, business records, proprietary data, and sensitive matters disclosed by clients during consultations must be kept in absolute confidence under professional non-disclosure obligations.</p>
      <p>6.2. <strong>Prohibition of Recording:</strong> Experts may not screen-record, screenshot, record audio, or publish any consultation session or client material without prior express written authorization from both the client and XprtLink.</p>
      <p>6.3. <strong>Regulatory Compliance:</strong> Experts must comply with all applicable local data protection and privacy laws (including GDPR and CCPA) regarding any client information handled during professional engagements.</p>
    </article>

    <article class="card">
      <h3>07. Marketplace Standing &amp; Boost Visibility</h3>
      <p>7.1. <strong>Performance Ratings:</strong> Clients evaluate consultation quality through verified reviews and ratings. Experts must uphold an aggregate rating of 4.2 stars or higher. Consistently sub-par ratings trigger quality intervention or account suspension.</p>
      <p>7.2. <strong>Subscription &amp; Promotion Tiers:</strong> Optional expert subscription plans (Core, Professional, Elite) and featured profile placements enhance discovery. Ongoing promotion and badge privileges remain contingent upon adhering to these Expert Standards.</p>
    </article>

    <section class="cta">
      <h3>Have questions about expert standards?</h3>
      <p>Our dedicated operations and expert success teams are available to assist with onboarding, verification, and consultation best practices.</p>
      <a class="btn primary" href="mailto:support@xpertlink.com">Contact Expert Support</a>
      <button class="btn ghost" type="button" onclick="window.print()">Download as PDF</button>
    </section>

  </div>
</div>
</body>
</html>`
  },
];

export const subscriptionPlans = [
  {
    code: "core",
    name: "Core",
    tagline: 'For "New Experts"',
    description: 'For "New Experts"',
    priceMonthly: 9.99,
    visibilityBoost: "listing",
    isMostPopular: false,
    keyFeatures: [
      "Basic marketplace listing",
      "Standard visibility",
      "No advertisements",
    ],
  },
  {
    code: "professional",
    name: "Professional",
    tagline: 'For "Active Professionals"',
    description: 'For "Active Professionals"',
    priceMonthly: 29.99,
    visibilityBoost: "top_25",
    isMostPopular: true,
    keyFeatures: [
      "Top 25% search visibility",
      "1 Advertisement per month",
      "Enhanced marketplace listing",
    ],
  },
  {
    code: "elite",
    name: "Elite",
    tagline: 'For "High-Volume Experts"',
    description: 'For "High-Volume Experts"',
    priceMonthly: 49.99,
    visibilityBoost: "top_5",
    isMostPopular: false,
    keyFeatures: [
      "Top 5% search visibility",
      "4 Advertisements per month (1/week)",
      "Maximum marketplace visibility",
    ],
  },
];
