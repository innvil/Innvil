-- ============================================================================
-- Innvil Watch — Telegram bot disconnect/reconnect for a Watcher Profile.
--
-- Adds a real "was connected, now explicitly disconnected" state to
-- virtual_moderators.provisioning_status, distinct from every existing
-- pre-connection status ('draft', 'cancelled', 'expired', ...) -- none of
-- those honestly describe "this Watcher HAD a working bot, the owner
-- deliberately disconnected it." Additive only: no existing rows change
-- value, no data is dropped.
-- ============================================================================

alter table virtual_moderators drop constraint if exists virtual_moderators_provisioning_status_check;
alter table virtual_moderators add constraint virtual_moderators_provisioning_status_check
  check (provisioning_status in (
    'draft', 'telegram_confirmation_pending', 'telegram_created',
    'credential_setup', 'bot_ready', 'community_setup_required', 'active',
    'cancelled', 'username_unavailable', 'telegram_creation_failed',
    'credential_setup_failed', 'expired', 'requires_retry', 'disconnected'
  ));
