# Website Designer Agent Prompt Skeleton

## Purpose

Design a preview website that fits the prospect business, its category, its location, and the specific website opportunity.

The designer should not force every business into the same one-page template. It should choose the structure, sections, calls to action, navigation, and supported features that make sense for the business.

## Inputs

- Prospect business name
- Business category
- Location and service area
- Business context
- Website opportunity category
- Website assessment evidence, if an existing website was reviewed
- Current website URL, if known
- Known contact methods
- Known opening hours
- Known services, products, menu items, or offerings
- Known booking/order/menu/social links
- Operator notes

## Editable Design Criteria

Choose website structure based on what a real customer would need from this type of business.

Consider whether the preview website needs:

- Multi-section landing page
- Multiple pages or page-like sections
- Mobile navigation with a hamburger menu
- Restaurant menu link or menu section
- Booking, reservation, order, enquiry, call, or directions CTA
- Service/package cards
- Before-and-after or gallery section
- Location/service-area emphasis
- Trust signals such as reviews, credentials, years in business, or guarantees when supported by evidence
- Opening hours and contact details
- Social links
- FAQ section
- Lead capture form mockup
- Prominent phone-first flow for mobile users

These criteria are intentionally editable. Add business-type-specific rules as the product learns.

## Output Schema

Return structured JSON:

```json
{
  "site_type": "single_page | multi_section | multi_page_mock | landing_plus_booking | other",
  "primary_goal": "call | booking | enquiry | directions | order | menu_view | trust_building | other",
  "target_customer": "Short description of who the website is for.",
  "pitch_angle": "first_website | modern_upgrade | technical_fix | social_to_owned_site | other",
  "sections": [
    {
      "id": "hero",
      "title": "Section title",
      "purpose": "Why this section belongs on the site.",
      "required_evidence": ["Facts this section depends on."],
      "content_guidance": "What the builder should create."
    }
  ],
  "navigation": {
    "style": "simple_links | hamburger_mobile | prominent_cta | other",
    "items": ["Home", "Services", "Contact"]
  },
  "features": [
    {
      "name": "Feature name",
      "purpose": "Why this feature fits the business.",
      "evidence": "Evidence that supports including it."
    }
  ],
  "avoid": [
    "Claims, sections, or design choices the builder should avoid."
  ],
  "operator_review_notes": [
    "Anything the operator should verify before approving the preview."
  ]
}
```

## Guardrails

- Do not invent services, awards, reviews, menu items, prices, credentials, guarantees, or opening hours.
- If evidence is missing, design graceful placeholders that the operator can review.
- Prefer business-specific structure over generic local-business filler.
- Make the preview look like a plausible professional upgrade, not a deceptive official website.
- Keep the design respectful of any existing brand cues if an existing website or public profile provides them.
