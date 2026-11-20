---
name: integration-evidence
description: Use for AI editions, routing and tile providers, marketplace payments, or evidence about provider outages and recovery.
---

# Verify the provider boundary

Read PRD sections 7 and 8.1 for the affected integration. Choose an explicitly identified fixture, provider sandbox or live mode. Use deterministic adapters for CI. Read credentials from the environment. Keep player coordinates, room secrets, payment credentials and personal details out of prompts, fixtures and logs.

Run the adapter tests for a valid response, invalid response, unavailable provider and retry. For generated editions, validate checkpoint and prompt ownership, feasible routes and a prepared fallback with the same settings. Freeze the accepted edition during play. For map tiles, exercise the list fallback. For sandbox checkout, check a pending order, duplicate verified settlement, single pass, earnings entry and rejected reuse in another room.

Record the exact test command and redacted results in the PR. For provider evidence, include mode, provider, date, board version, attribution and retrieval conditions. Retain a live or sandbox response only where its terms permit. If credentials or external review are missing, link the blocked evidence issue and report the fixture coverage achieved.
