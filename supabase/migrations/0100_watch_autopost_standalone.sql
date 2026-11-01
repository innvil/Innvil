-- AI Telegram Auto-Posting -- standalone (Panel-less) accounts (extends
-- Phase 4.N part B / migration 0055 to the direct-Watch account model).
--
-- auto_post_windows.panel_id has been NOT NULL since 0055, making
-- Auto-Posting reachable ONLY through the legacy Panel-distributed Virtual
-- Moderator flow -- a real, previously-flagged gap: the Watch landing page
-- advertises Auto-Posting as a real capability, but a direct/standalone
-- Watch account (the product's actual primary customer) could never use it.
--
-- Same pattern already established for moderator_deployments/communities/
-- telegram_bot_integrations (migration 0069) and watch_byo_usage_policies'
-- Community scope: panel_id nullable, ownership for a standalone window
-- derives from its parent chain instead (moderator_deployment_id ->
-- community_id -> project_id -> account_id).

alter table auto_post_windows alter column panel_id drop not null;
