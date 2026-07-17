// Contenu de la page Legal & Privacy (fidèle à views/legal.ejs).
// Blocs : label | h2 | h3 | p | ul | note | table.
export const LEGAL_UPDATED = 'June 10, 2026';
export const LEGAL_CONTACT = 'info@jiayou.fr';

export const LEGAL_BLOCKS = [
  // ══ TERMS OF USE ══
  { t: 'label', text: 'Terms of Use' },
  { t: 'h2', text: 'Terms of Use' },
  { t: 'p', text: 'By accessing or using the 加油！(Jiayou!) application or website at jiayou.fr (collectively "the Service"), you agree to be bound by these Terms of Use ("Terms"). If you do not agree to these Terms, please do not use the Service.' },
  { t: 'p', text: 'The Service is operated by Jiayou ("we", "us", or "our"), reachable at jiayou.fr and info@jiayou.fr.' },
  { t: 'note', text: 'HSK Disclaimer. 加油！is an independent educational game and is not affiliated with, endorsed by, or connected to the official HSK (Hanyu Shuiping Kaoshi) examination or any of its governing bodies (Hanban / Chinese International Chinese Education Foundation). HSK level labels are used solely as a reference framework for vocabulary difficulty.' },

  { t: 'h3', text: '1. Eligibility' },
  { t: 'p', text: 'You must be at least 13 years old to use the Service. If you are under 18, you confirm that you have obtained parental or guardian consent. By using the Service, you represent that you meet these age requirements.' },

  { t: 'h3', text: '2. User Accounts' },
  { t: 'p', text: 'You may create an account using Google Sign-In (OAuth 2.0) or email/password. When you create an account, you agree to:' },
  { t: 'ul', items: [
    'Provide accurate and up-to-date information.',
    'Keep your login credentials confidential.',
    'Notify us immediately of any unauthorized use of your account at info@jiayou.fr.',
    'Take responsibility for all activities that occur under your account.',
  ] },
  { t: 'p', text: 'We reserve the right to suspend or terminate accounts that violate these Terms or that have been inactive for more than 24 months, with prior notice by email.' },

  { t: 'h3', text: '3. The Service' },
  { t: 'p', text: 'Jiayou is a Chinese language learning application offering:' },
  { t: 'ul', items: [
    'Vocabulary quizzes based on HSK levels 1–6, with configurable difficulty modes (Discovery, Balanced, Revision).',
    'Personal word collections — add and manage words you want to learn.',
    'Duels — real-time vocabulary challenges with other users.',
    'Progress tracking — quiz history, mastery scores, contributions heatmap.',
    'Virtual coins — earned through quiz performance (see Section 6).',
    'Progressive Web App (PWA) — installable on mobile and desktop for offline-compatible access.',
  ] },
  { t: 'p', text: 'The Service is provided "as is". Features may evolve over time. We will communicate significant changes via the app or by email.' },

  { t: 'h3', text: '4. User Conduct' },
  { t: 'p', text: 'You agree not to:' },
  { t: 'ul', items: [
    'Use the Service for any unlawful purpose or in violation of applicable regulations.',
    'Attempt to gain unauthorized access to any part of the Service, its servers, or databases.',
    'Reverse-engineer, decompile, or disassemble any part of the Service.',
    'Scrape, harvest, or collect user data without authorization.',
    'Use automated tools (bots, scripts) to interact with the Service in a way that disrupts its normal operation.',
    'Upload or transmit viruses, malware, or any other harmful code.',
    'Impersonate another person or entity.',
    'Manipulate quiz scores, duel results, or the virtual coin system through any technical means.',
    'Harass, abuse, or harm other users through the duel or messaging features.',
  ] },
  { t: 'p', text: 'Violation of these rules may result in immediate account suspension without refund of any subscription fees paid.' },

  { t: 'h3', text: '5. Premium Subscriptions & Payments' },
  { t: 'h3', text: '5.1 Plans' },
  { t: 'p', text: 'Jiayou offers a Free plan and a Premium paid plan. Premium features include, but are not limited to: unlimited vocabulary words, unlimited daily quizzes, unlimited duels, and offline access.' },
  { t: 'h3', text: '5.2 Payment Processing' },
  { t: 'p', text: "Payments are processed by Stripe, Inc. — a PCI-DSS compliant third-party payment provider. Jiayou does not store your credit card details. By subscribing, you also agree to Stripe's Terms of Service." },
  { t: 'h3', text: '5.3 Billing & Auto-Renewal' },
  { t: 'p', text: 'Subscriptions are billed on a recurring basis (monthly or annual, depending on the plan chosen) and renew automatically unless cancelled before the renewal date. You will receive an email reminder before each renewal.' },
  { t: 'h3', text: '5.4 Cancellation' },
  { t: 'p', text: 'You may cancel your subscription at any time from your account settings or by contacting info@jiayou.fr. Cancellation takes effect at the end of the current billing period. You retain Premium access until that date.' },
  { t: 'h3', text: '5.5 Refunds' },
  { t: 'p', text: 'In accordance with French consumer law (Code de la consommation), you have a 14-day right of withdrawal from the date of your first subscription purchase, provided you have not actively started using the Premium features. To request a refund, contact info@jiayou.fr within this period. After 14 days, refunds are issued at our sole discretion.' },
  { t: 'h3', text: '5.6 Price Changes' },
  { t: 'p', text: 'We reserve the right to modify subscription prices. We will notify you by email at least 30 days in advance of any price change. If you do not cancel before the new price takes effect, you consent to the updated price.' },
  { t: 'h3', text: '5.7 Failed Payments' },
  { t: 'p', text: 'If a payment fails, we will attempt to notify you by email. Your account may be downgraded to the Free plan if payment cannot be collected after retry attempts.' },

  { t: 'h3', text: '6. Virtual Currency (Coins ₵)' },
  { t: 'p', text: 'Jiayou uses a virtual in-app currency called Coins (₵), earned by completing quizzes and achieving good scores. Coins are used for in-app features and rankings.' },
  { t: 'note', text: 'Important: Coins have no monetary value, cannot be exchanged for real money, transferred between accounts, or refunded. They are a purely virtual reward mechanism with no commercial value outside the app.' },
  { t: 'p', text: 'We reserve the right to adjust coin earning rates or reset balances at any time, with reasonable notice provided in-app.' },

  { t: 'h3', text: '7. Intellectual Property' },
  { t: 'p', text: 'All content, design, software, and trademarks of the Service — including the name "Jiayou", the logo, quiz content, and vocabulary databases — are the exclusive property of Jiayou and are protected by applicable intellectual property laws.' },
  { t: 'p', text: 'You are granted a limited, non-exclusive, non-transferable, revocable license to use the Service for personal, non-commercial purposes only.' },
  { t: 'p', text: 'You may not copy, modify, distribute, sell, or create derivative works of any part of the Service without our prior written permission.' },

  { t: 'h3', text: '8. Disclaimers' },
  { t: 'p', text: 'The Service is provided "as is" and "as available" without warranties of any kind, whether express or implied, including but not limited to fitness for a particular purpose, accuracy, or uninterrupted availability.' },
  { t: 'p', text: 'We do not guarantee that:' },
  { t: 'ul', items: [
    'The Service will be error-free or uninterrupted.',
    'Quiz results or mastery scores accurately reflect your real-world Chinese proficiency.',
    'The vocabulary content is exhaustive or equivalent to official HSK syllabi.',
  ] },
  { t: 'p', text: 'Learning outcomes depend on individual effort and are not guaranteed by the Service.' },

  { t: 'h3', text: '9. Limitation of Liability' },
  { t: 'p', text: 'To the maximum extent permitted by applicable law, Jiayou shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of profits, or service interruption, arising from your use of the Service.' },
  { t: 'p', text: 'Our total liability to you for any claim arising from these Terms or your use of the Service shall not exceed the amount you paid to Jiayou in the 12 months preceding the event giving rise to the claim.' },

  { t: 'h3', text: '10. Termination' },
  { t: 'p', text: 'You may delete your account at any time from your account settings. Upon deletion:' },
  { t: 'ul', items: [
    'Your personal data will be deleted within 30 days, except where retention is required by law (e.g., financial records).',
    'Your virtual coin balance and quiz history will be permanently erased.',
    'Any active Premium subscription will be cancelled and no refund will be issued for the remaining period, unless required by law.',
  ] },
  { t: 'p', text: 'We may suspend or terminate your account without notice if you materially breach these Terms, engage in fraudulent activity, or if required by law.' },

  { t: 'h3', text: '11. Changes to These Terms' },
  { t: 'p', text: 'We may update these Terms from time to time. When we make material changes, we will notify you by email or via an in-app notification at least 15 days before the changes take effect. Continued use of the Service after the effective date constitutes acceptance of the updated Terms.' },

  { t: 'h3', text: '12. Governing Law & Dispute Resolution' },
  { t: 'p', text: 'These Terms are governed by the laws of France. Any dispute arising from or relating to these Terms shall first be subject to good-faith negotiation. If unresolved, disputes shall be submitted to the exclusive jurisdiction of the competent courts of France.' },
  { t: 'p', text: 'If you are a consumer in the EU, you may also use the EU Online Dispute Resolution platform (ec.europa.eu/consumers/odr).' },

  // ══ PRIVACY POLICY ══
  { t: 'label', text: 'Privacy Policy' },
  { t: 'h2', text: 'Privacy Policy' },
  { t: 'p', text: 'This Privacy Policy explains how Jiayou collects, uses, stores, and protects your personal data when you use the Service at jiayou.fr. We are committed to complying with the General Data Protection Regulation (GDPR) (EU 2016/679) and applicable French data protection law.' },
  { t: 'p', text: 'Data Controller: Jiayou — info@jiayou.fr' },

  { t: 'h3', text: '1. Data We Collect' },
  { t: 'table', head: ['Category', 'Data', 'Source'], rows: [
    ['Account', 'Email address, display name, profile picture URL', 'Google OAuth or registration form'],
    ['Authentication', 'OAuth tokens (not stored in plain text), session identifiers', 'Google Sign-In / Passport.js'],
    ['Learning activity', 'Quiz history (score, ratio, words used, date), word collection, mastery scores per word', 'In-app activity'],
    ['Subscription', 'Plan name, subscription status, billing period dates', 'Stripe webhook events'],
    ['Payments', 'Stripe Customer ID (reference only — card details are held by Stripe)', 'Stripe'],
    ['Usage', 'Duel results, coin balance, last login timestamp', 'In-app activity'],
    ['Technical', 'IP address (for security), session data stored server-side', 'Server logs'],
  ] },
  { t: 'p', text: 'We do not collect sensitive personal data (health, financial account numbers, government IDs), and we do not build advertising profiles.' },

  { t: 'h3', text: '2. How We Use Your Data' },
  { t: 'table', head: ['Purpose', 'Legal Basis (GDPR)'], rows: [
    ['Provide and operate the Service (authentication, quiz logic, progress tracking)', 'Performance of a contract (Art. 6(1)(b))'],
    ['Process payments and manage subscriptions', 'Performance of a contract (Art. 6(1)(b))'],
    ['Send transactional emails (subscription confirmations, renewal reminders)', 'Performance of a contract (Art. 6(1)(b))'],
    ['Detect fraud, abuse, and security incidents', 'Legitimate interests (Art. 6(1)(f))'],
    ['Improve the Service through aggregated, anonymised analytics', 'Legitimate interests (Art. 6(1)(f))'],
    ['Comply with legal obligations (e.g., accounting, tax records)', 'Legal obligation (Art. 6(1)(c))'],
  ] },

  { t: 'h3', text: '3. Third-Party Services' },
  { t: 'table', head: ['Provider', 'Purpose', 'Privacy Policy'], rows: [
    ['Google (OAuth)', 'Authentication — we receive your email and name from Google when you sign in', 'policies.google.com/privacy'],
    ['Stripe', 'Payment processing — handles your card data securely (PCI-DSS Level 1)', 'stripe.com/privacy'],
    ['Hosting / Cloud', 'Server and database infrastructure (data may be processed in the EU or US under Standard Contractual Clauses)', 'Available on request'],
  ] },
  { t: 'p', text: 'We do not sell, rent, or share your personal data with third parties for marketing purposes.' },

  { t: 'h3', text: '4. Cookies & Local Storage' },
  { t: 'p', text: 'We use the following technologies to store data on your device:' },
  { t: 'ul', items: [
    'Session cookie — a strictly necessary cookie that keeps you logged in during your visit. It is deleted when you close your browser or log out.',
    'IndexedDB / localStorage — used by the PWA to cache vocabulary data for offline use and to store your quiz progress locally. This data stays on your device and is not transmitted to our servers except during sync operations.',
    'Service Worker cache — stores app assets (HTML, CSS, JS, images) for offline access. No personal data is included in the cache.',
  ] },
  { t: 'p', text: 'We do not use third-party tracking cookies or advertising cookies. The session cookie is strictly necessary; no consent banner is required for its use under the ePrivacy Directive.' },

  { t: 'h3', text: '5. Data Retention' },
  { t: 'ul', items: [
    'Account data — retained for as long as your account is active. Deleted within 30 days of account deletion.',
    'Quiz history & learning data — retained for the life of your account. Deleted with your account.',
    'Payment records — retained for 10 years as required by French accounting law (Code de commerce, Art. L123-22). Only transaction references (not card details) are stored by us.',
    'Server logs (IP addresses) — retained for a maximum of 12 months for security purposes.',
    'Inactive accounts — accounts with no login for 24 consecutive months may be deleted after prior email notice.',
  ] },

  { t: 'h3', text: '6. Security' },
  { t: 'p', text: 'We implement appropriate technical and organisational measures to protect your data, including:' },
  { t: 'ul', items: [
    'HTTPS (TLS) for all data in transit.',
    'Password hashing using bcrypt (for local accounts).',
    'Server-side session management with encrypted session tokens.',
    'No storage of plain-text credentials or payment card data.',
    'Regular database backups.',
  ] },
  { t: 'p', text: 'Despite these measures, no system is completely secure. In the event of a data breach affecting your rights, we will notify you and the relevant supervisory authority (CNIL) within 72 hours as required by GDPR Art. 33.' },

  { t: 'h3', text: '7. Your Rights (GDPR)' },
  { t: 'p', text: 'Under the GDPR, you have the following rights:' },
  { t: 'table', head: ['Right', 'Description'], rows: [
    ['Access (Art. 15)', 'Request a copy of the personal data we hold about you.'],
    ['Rectification (Art. 16)', 'Request correction of inaccurate or incomplete data.'],
    ['Erasure (Art. 17)', 'Request deletion of your personal data ("right to be forgotten").'],
    ['Portability (Art. 20)', 'Request your data in a structured, machine-readable format (e.g., JSON export of your word collection and quiz history).'],
    ['Restriction (Art. 18)', 'Request that we restrict processing of your data in certain circumstances.'],
    ['Objection (Art. 21)', 'Object to processing based on legitimate interests.'],
    ['Withdraw consent', 'Where processing is based on consent, you may withdraw it at any time without affecting the lawfulness of prior processing.'],
  ] },
  { t: 'p', text: 'To exercise any of these rights, contact us at info@jiayou.fr. We will respond within 30 days. You may also lodge a complaint with the CNIL (Commission Nationale de l\'Informatique et des Libertés): cnil.fr.' },

  { t: 'h3', text: "8. Children's Privacy" },
  { t: 'p', text: 'The Service is not directed at children under 13. We do not knowingly collect personal data from children under 13 without verifiable parental consent. If you believe a child under 13 has created an account without consent, please contact us at info@jiayou.fr and we will delete the account promptly.' },

  { t: 'h3', text: '9. Contact & Data Controller' },
  { t: 'p', text: 'For any questions, requests, or concerns regarding these Terms or our Privacy Policy:' },
  { t: 'ul', items: [
    'Email: info@jiayou.fr',
    'Website: jiayou.fr',
  ] },
];
