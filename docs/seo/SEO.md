# SEO & Content Strategy

## Objective

SEO is not a P0 engineering dependency, but product architecture should preserve the ability to launch a fast, indexable public site without coupling marketing pages to the desktop application.

## Positioning

Lead with user outcomes rather than generic AI claims:

- prepare for a specific interview
- get grounded help from your real experience
- practice weak questions
- review and improve after interviews

Avoid making the brand dependent on a single competitor comparison or on claims of invisibility/undetectability.

## Search-intent clusters

### High intent

- AI interview assistant
- AI interview copilot
- interview assistant for developers
- interview practice AI
- mock interview AI
- interview answer assistant

### Role / skill landing pages

Create useful pages only when there is genuinely role-specific content, examples or question sets:

- software engineer interview assistant
- PHP/Symfony interview questions
- React interview practice
- system design interview practice
- product manager interview practice
- data engineer interview practice

Avoid programmatic SEO pages that differ only by replacing a keyword.

### Problem-led content

- how to prepare answers from a job description
- STAR interview examples
- how to make interview answers concise
- how to prepare for a technical interview
- recruiter screen preparation
- salary negotiation preparation

## Site architecture

```text
/
/product/interview-copilot
/product/mock-interviews
/product/interview-prep
/product/interview-review
/roles/<role>
/skills/<skill>
/resources/<article>
/pricing
/security
/privacy
/download
```

## Technical SEO requirements

- Public marketing pages rendered as static/SSR HTML.
- Core content must not depend on client-side hydration to be indexable.
- Per-page title, description, canonical URL and Open Graph metadata.
- Structured data only when it truthfully matches visible content.
- XML sitemap split by content type when scale requires it.
- `robots.txt` must exclude authenticated/session/private content.
- Fast pages: optimize LCP/INP/CLS before adding decorative effects.
- Semantic headings and accessible link text.
- No indexing of user opportunities, transcripts, profile documents or generated private content.

## Content moat

The strongest long-term SEO asset is not generic AI-written articles; it is structured, genuinely useful interview intelligence:

- role-specific question libraries
- company/process preparation where legally and ethically sourced
- technical interview guides
- anonymized aggregate insights only with sufficient privacy safeguards
- interactive preparation/checklist tools

## Comparison pages

Competitor comparison pages can exist later, but should compare verifiable product capabilities and avoid copying competitor copy, trademarks as branding, or unsupported superiority claims.

## Measurement

Track separately:

- organic landing sessions
- signup rate by landing page
- opportunity-created rate from organic users
- first-session activation
- paid conversion
- assisted conversions from educational content

Traffic without activation is not a useful SEO win.
