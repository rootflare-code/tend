create type public.mobile_command_state as enum (
  'pending',
  'claimed',
  'applied',
  'rejected',
  'cancelled'
);

create table public.mobile_feeds (
  user_id uuid not null,
  feed_id text not null,
  position integer not null,
  name text not null,
  review_count integer not null default 0,
  queued_count integer not null default 0,
  working_count integer not null default 0,
  generation text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, feed_id)
);

create table public.mobile_cards (
  user_id uuid not null,
  feed_id text not null,
  card_id text not null,
  item_kind text not null,
  status text not null,
  reviewable boolean not null default false,
  review_position integer,
  feed_generation text not null,
  card_digest text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, feed_id, card_id),
  foreign key (user_id, feed_id) references public.mobile_feeds (user_id, feed_id) on delete cascade
);

create table public.mobile_mind_snapshot (
  user_id uuid primary key,
  health text not null,
  snapshot_generation text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.mobile_commands (
  id uuid primary key,
  user_id uuid not null,
  client_request_id uuid not null,
  device_id text not null,
  feed_id text not null,
  card_id text not null,
  feed_generation text not null,
  expected_card_digest text not null,
  kind text not null check (kind in (
    'archive',
    'instruction',
    'approve_action',
    'approve_routine_action',
    'edit_queued_instruction',
    'return_to_review'
  )),
  payload jsonb not null default '{}'::jsonb,
  state public.mobile_command_state not null default 'pending',
  available_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  result_work_id text,
  work_status text,
  response text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

create table public.mobile_sync_status (
  user_id uuid primary key,
  worker_id text not null,
  schema_version integer not null,
  snapshot_generation text not null,
  last_heartbeat_at timestamptz not null,
  last_error text,
  updated_at timestamptz not null default now()
);

create index mobile_cards_review_idx
  on public.mobile_cards (user_id, feed_id, reviewable, review_position);
create index mobile_commands_claim_idx
  on public.mobile_commands (user_id, state, available_at, lease_expires_at, created_at);
create index mobile_commands_activity_idx
  on public.mobile_commands (user_id, updated_at desc);

alter table public.mobile_feeds enable row level security;
alter table public.mobile_cards enable row level security;
alter table public.mobile_mind_snapshot enable row level security;
alter table public.mobile_commands enable row level security;
alter table public.mobile_sync_status enable row level security;

create policy "mobile feeds are private"
  on public.mobile_feeds for select to authenticated
  using (auth.uid() = user_id);

create policy "mobile cards are private"
  on public.mobile_cards for select to authenticated
  using (auth.uid() = user_id);

create policy "mobile mind is private"
  on public.mobile_mind_snapshot for select to authenticated
  using (auth.uid() = user_id);

create policy "mobile commands are private"
  on public.mobile_commands for select to authenticated
  using (auth.uid() = user_id);

create policy "mobile sync status is private"
  on public.mobile_sync_status for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.mobile_feeds from anon, authenticated;
revoke all on public.mobile_cards from anon, authenticated;
revoke all on public.mobile_mind_snapshot from anon, authenticated;
revoke all on public.mobile_commands from anon, authenticated;
revoke all on public.mobile_sync_status from anon, authenticated;

grant select on public.mobile_feeds to authenticated;
grant select on public.mobile_cards to authenticated;
grant select on public.mobile_mind_snapshot to authenticated;
grant select on public.mobile_commands to authenticated;
grant select on public.mobile_sync_status to authenticated;

create or replace function public.replace_mobile_snapshot(
  p_user_id uuid,
  p_worker_id text,
  p_snapshot jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feed jsonb;
  v_card jsonb;
  v_schema_version integer;
  v_generation text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  v_schema_version := (p_snapshot ->> 'schemaVersion')::integer;
  if v_schema_version <> 1 then
    raise exception 'unsupported mobile schema version %', v_schema_version;
  end if;
  v_generation := p_snapshot ->> 'generation';
  if coalesce(v_generation, '') = '' then
    raise exception 'snapshot generation is required';
  end if;

  for v_feed in select value from jsonb_array_elements(coalesce(p_snapshot -> 'feeds', '[]'::jsonb))
  loop
    insert into public.mobile_feeds (
      user_id,
      feed_id,
      position,
      name,
      review_count,
      queued_count,
      working_count,
      generation,
      payload,
      updated_at
    ) values (
      p_user_id,
      v_feed ->> 'id',
      (v_feed ->> 'position')::integer,
      v_feed ->> 'name',
      (v_feed ->> 'reviewCount')::integer,
      (v_feed ->> 'queuedCount')::integer,
      (v_feed ->> 'workingCount')::integer,
      v_feed ->> 'generation',
      v_feed,
      coalesce((v_feed ->> 'updatedAt')::timestamptz, now())
    )
    on conflict (user_id, feed_id) do update set
      position = excluded.position,
      name = excluded.name,
      review_count = excluded.review_count,
      queued_count = excluded.queued_count,
      working_count = excluded.working_count,
      generation = excluded.generation,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  end loop;

  delete from public.mobile_feeds f
  where f.user_id = p_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_snapshot -> 'feeds', '[]'::jsonb)) item
      where item ->> 'id' = f.feed_id
    );

  for v_card in select value from jsonb_array_elements(coalesce(p_snapshot -> 'cards', '[]'::jsonb))
  loop
    insert into public.mobile_cards (
      user_id,
      feed_id,
      card_id,
      item_kind,
      status,
      reviewable,
      review_position,
      feed_generation,
      card_digest,
      payload,
      updated_at
    ) values (
      p_user_id,
      v_card ->> 'feedId',
      v_card ->> 'cardId',
      v_card ->> 'itemKind',
      v_card ->> 'status',
      coalesce((v_card ->> 'reviewable')::boolean, false),
      case when v_card ? 'reviewPosition' then (v_card ->> 'reviewPosition')::integer else null end,
      v_card ->> 'feedGeneration',
      v_card ->> 'cardDigest',
      v_card,
      coalesce((v_card ->> 'updatedAt')::timestamptz, now())
    )
    on conflict (user_id, feed_id, card_id) do update set
      item_kind = excluded.item_kind,
      status = excluded.status,
      reviewable = excluded.reviewable,
      review_position = excluded.review_position,
      feed_generation = excluded.feed_generation,
      card_digest = excluded.card_digest,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  end loop;

  delete from public.mobile_cards c
  where c.user_id = p_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_snapshot -> 'cards', '[]'::jsonb)) item
      where item ->> 'feedId' = c.feed_id
        and item ->> 'cardId' = c.card_id
    );

  insert into public.mobile_mind_snapshot (
    user_id,
    health,
    snapshot_generation,
    payload,
    updated_at
  ) values (
    p_user_id,
    p_snapshot #>> '{mind,health}',
    v_generation,
    p_snapshot -> 'mind',
    coalesce((p_snapshot ->> 'generatedAt')::timestamptz, now())
  )
  on conflict (user_id) do update set
    health = excluded.health,
    snapshot_generation = excluded.snapshot_generation,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  insert into public.mobile_sync_status (
    user_id,
    worker_id,
    schema_version,
    snapshot_generation,
    last_heartbeat_at,
    last_error,
    updated_at
  ) values (
    p_user_id,
    p_worker_id,
    v_schema_version,
    v_generation,
    now(),
    null,
    now()
  )
  on conflict (user_id) do update set
    worker_id = excluded.worker_id,
    schema_version = excluded.schema_version,
    snapshot_generation = excluded.snapshot_generation,
    last_heartbeat_at = excluded.last_heartbeat_at,
    last_error = null,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.submit_mobile_command(
  p_command jsonb
) returns setof public.mobile_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_client_request_id uuid;
  v_feed_id text;
  v_card_id text;
  v_kind text;
  v_card public.mobile_cards%rowtype;
  v_action jsonb;
  v_existing public.mobile_commands%rowtype;
  v_payload jsonb;
  v_available_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  v_id := (p_command ->> 'id')::uuid;
  v_client_request_id := (p_command ->> 'clientRequestId')::uuid;
  v_feed_id := p_command ->> 'feedId';
  v_card_id := p_command ->> 'cardId';
  v_kind := p_command ->> 'kind';
  if coalesce(v_feed_id, '') = '' or coalesce(v_card_id, '') = '' then
    raise exception 'feedId and cardId are required';
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'actionId', p_command -> 'actionId',
    'expectedActionDigest', p_command -> 'expectedActionDigest',
    'routineActionGroupId', p_command -> 'routineActionGroupId',
    'instruction', p_command -> 'instruction',
    'edits', p_command -> 'edits',
    'targetWorkId', p_command -> 'targetWorkId',
    'expectedWorkDigest', p_command -> 'expectedWorkDigest',
    'riskConfirmation', p_command -> 'riskConfirmation'
  ));

  select * into v_existing
  from public.mobile_commands
  where user_id = v_user_id and client_request_id = v_client_request_id;
  if found then
    if v_existing.id is distinct from v_id
      or v_existing.device_id is distinct from p_command ->> 'deviceId'
      or v_existing.feed_id is distinct from v_feed_id
      or v_existing.card_id is distinct from v_card_id
      or v_existing.feed_generation is distinct from p_command ->> 'feedGeneration'
      or v_existing.kind is distinct from v_kind
      or v_existing.expected_card_digest is distinct from p_command ->> 'expectedCardDigest'
      or v_existing.payload is distinct from v_payload then
      raise exception 'clientRequestId was already used for a different command';
    end if;
    return next v_existing;
    return;
  end if;

  select * into v_card
  from public.mobile_cards
  where user_id = v_user_id and feed_id = v_feed_id and card_id = v_card_id;
  if not found then
    raise exception 'card is no longer available';
  end if;
  if v_card.feed_generation <> p_command ->> 'feedGeneration' then
    raise exception 'feed advanced to a newer pass';
  end if;
  if v_card.card_digest <> p_command ->> 'expectedCardDigest' then
    raise exception 'card changed after review';
  end if;

  if v_kind in ('archive', 'approve_action', 'approve_routine_action') then
    select value into v_action
    from jsonb_array_elements(coalesce(v_card.payload -> 'actions', '[]'::jsonb))
    where value ->> 'id' = coalesce(
      p_command ->> 'actionId',
      case when v_kind = 'archive' then 'default-cleanup' else 'approve-routine-action' end
    );
    if v_action is null then
      raise exception 'selected action is no longer available';
    end if;
    if v_action ->> 'digest' <> p_command ->> 'expectedActionDigest' then
      raise exception 'selected action changed after review';
    end if;
  end if;

  if v_kind = 'edit_queued_instruction' then
    if v_card.payload #>> '{activeWork,id}' <> p_command ->> 'targetWorkId'
      or v_card.payload #>> '{activeWork,digest}' <> p_command ->> 'expectedWorkDigest' then
      raise exception 'queued work changed before the edit arrived';
    end if;
  end if;

  v_available_at := case when v_kind = 'archive' then now() + interval '5 seconds' else now() end;

  insert into public.mobile_commands (
    id,
    user_id,
    client_request_id,
    device_id,
    feed_id,
    card_id,
    feed_generation,
    expected_card_digest,
    kind,
    payload,
    available_at
  ) values (
    v_id,
    v_user_id,
    v_client_request_id,
    p_command ->> 'deviceId',
    v_feed_id,
    v_card_id,
    p_command ->> 'feedGeneration',
    p_command ->> 'expectedCardDigest',
    v_kind,
    v_payload,
    v_available_at
  )
  returning * into v_existing;
  return next v_existing;
end;
$$;

create or replace function public.cancel_mobile_command(
  p_command_id uuid
) returns setof public.mobile_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  return query
  update public.mobile_commands
  set state = 'cancelled',
      updated_at = now()
  where id = p_command_id
    and user_id = v_user_id
    and state = 'pending'
    and now() < available_at
  returning *;
end;
$$;

create or replace function public.claim_mobile_commands(
  p_user_id uuid,
  p_worker_id text,
  p_limit integer default 20
) returns setof public.mobile_commands
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  return query
  with candidates as (
    select id
    from public.mobile_commands
    where user_id = p_user_id
      and (
        (state = 'pending' and available_at <= now())
        or (state = 'claimed' and lease_expires_at <= now())
      )
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.mobile_commands command
  set state = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = now(),
      lease_expires_at = now() + interval '2 minutes',
      updated_at = now()
  from candidates
  where command.id = candidates.id
  returning command.*;
end;
$$;

create or replace function public.complete_mobile_command(
  p_command_id uuid,
  p_worker_id text,
  p_state text,
  p_work_id text default null,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_state not in ('applied', 'rejected') then
    raise exception 'invalid terminal command state';
  end if;
  update public.mobile_commands
  set state = p_state::public.mobile_command_state,
      result_work_id = p_work_id,
      work_status = case when p_work_id is null then null else 'queued' end,
      error = p_error,
      lease_expires_at = null,
      updated_at = now()
  where id = p_command_id
    and state = 'claimed'
    and claimed_by = p_worker_id;
  if not found then
    raise exception 'mobile command lease is no longer owned by this worker';
  end if;
end;
$$;

create or replace function public.sync_mobile_command_progress(
  p_user_id uuid,
  p_worker_id text,
  p_progress jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_progress, '[]'::jsonb))
  loop
    update public.mobile_commands
    set result_work_id = v_item ->> 'workId',
        work_status = v_item ->> 'workStatus',
        response = nullif(v_item ->> 'response', ''),
        error = nullif(v_item ->> 'error', ''),
        updated_at = greatest(updated_at, coalesce((v_item ->> 'updatedAt')::timestamptz, now()))
    where user_id = p_user_id
      and state = 'applied'
      and claimed_by = p_worker_id
      and (
        id = (v_item ->> 'commandId')::uuid
        or result_work_id = v_item ->> 'workId'
      );
  end loop;
end;
$$;

revoke all on function public.replace_mobile_snapshot(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_mobile_commands(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_mobile_command(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sync_mobile_command_progress(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_mobile_snapshot(uuid, text, jsonb) to service_role;
grant execute on function public.claim_mobile_commands(uuid, text, integer) to service_role;
grant execute on function public.complete_mobile_command(uuid, text, text, text, text) to service_role;
grant execute on function public.sync_mobile_command_progress(uuid, text, jsonb) to service_role;

revoke all on function public.submit_mobile_command(jsonb) from public, anon;
revoke all on function public.cancel_mobile_command(uuid) from public, anon;
grant execute on function public.submit_mobile_command(jsonb) to authenticated;
grant execute on function public.cancel_mobile_command(uuid) to authenticated;

alter publication supabase_realtime add table public.mobile_feeds;
alter publication supabase_realtime add table public.mobile_cards;
alter publication supabase_realtime add table public.mobile_mind_snapshot;
alter publication supabase_realtime add table public.mobile_commands;
alter publication supabase_realtime add table public.mobile_sync_status;
