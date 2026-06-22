# Use LangGraph, TypeScript, and Postgres for the v1 workflow

The v1 system will use LangGraph with TypeScript and Postgres because the product is a durable agent workflow, not a single chat session: it needs explicit states, retries, audit trails, human review pauses, preview publication, and outreach decisions. TypeScript keeps the agent workflow close to the review dashboard, while Postgres owns the prospect registry, workflow state, generated artifacts, and compliance records.
