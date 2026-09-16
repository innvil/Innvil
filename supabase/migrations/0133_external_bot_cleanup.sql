begin;

alter table public.communities
  add column if not exists remove_external_bot_messages boolean not null default false;

comment on column public.communities.remove_external_bot_messages is
  'Opt-in silent deletion of incoming third-party bot posts, including bot admins. Never warns, strikes or restricts senders. Innvil bots and sender_chat identities are excluded. Requires Telegram bot-to-bot visibility and delete rights.';

commit;
