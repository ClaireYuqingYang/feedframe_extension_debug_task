# Debugging Brief

We are evaluating Chrome extension web development skills using two known issues from an earlier FeedFrame version. Please diagnose the likely root cause and propose or implement a robust fix.

## Issue 1: Author Avatar Should Be Covered By The Overlay

The extension applies a visual overlay or masking effect to certain Bluesky posts. In the current v1 behavior, the overlay can fail to cover the author's avatar, leaving the avatar visible even when the rest of the post is filtered, dimmed, blurred, or visually masked.

Expected behavior:

- When a post is filtered or masked, the author's avatar should be covered by the same overlay/masking treatment.
- The overlay should apply consistently to the intended full post area, including the avatar.
- The fix should work across Bluesky feed posts and post detail views if applicable.
- The fix should survive Bluesky SPA navigation and dynamic DOM updates.
- Avoid hardcoded pixel hacks unless clearly justified.

Useful starting points:

- `extension/content.js`
- `extension/styles.css`

## Issue 2: Duplicate Or Misleading Interaction Records

The extension records post interactions and sends them to the backend. In the v1 behavior, each click can create another database record, even when the user is canceling a previous interaction. For example, a user may like a post and then click again to unlike it, but the data pipeline can still accumulate multiple rows in a way that inflates or misrepresents engagement.

Expected behavior:

- Repeated clicking should not create misleading duplicate engagement records.
- Like then unlike should not be counted as a lasting like.
- The backend should be protected against duplicate submissions where reasonable.
- The data model should make it clear whether records represent raw events, latest state, or both.

Useful starting points:

- `extension/content.js`
- `extension/config.js`
- `backend/server.js`

## Deliverables

Please return:

- A short diagnosis of the likely root causes.
- A concise implementation plan.
- Code changes if you choose to implement them.
- A brief note on assumptions and tradeoffs.

Please do not work on model-side code.
