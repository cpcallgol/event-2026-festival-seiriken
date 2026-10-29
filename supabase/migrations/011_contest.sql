-- 紅華祭 整理券アプリ Supabase版 DB定義 v11：コンテストの投票（仮装コンテストなど）
-- 010_event_kinds.sql を実行したあとに、SQL Editor に全文を貼り付けて1回だけ実行します。
-- ・コンテストごとに出場者（エントリー番号・名前・学年と学科・テーマ）を登録する
-- ・来場者はエントリー番号で1位・2位・3位を選んで投票する（出場者が3組未満なら、その数だけ選ぶ）
-- ・1つのブラウザー（端末ID）で、1つのコンテストに1回だけ。投票後は変えられない
-- ・投票できるのは、開催日の開始〜終了の時刻の間だけ
-- ・順位（1位=3点・2位=2点・3位=1点の合計。同点なら1位に選ばれた数が多い方が上）は運営画面だけで見られる
-- これまでのデータは変更しません。最初のコンテストとして「仮装コンテスト」を1つ作ります。

create table public.contests (
  id bigint generated always as identity primary key,
  label text not null check (char_length(label) between 1 and 40),
  description text not null default '' check (char_length(description) <= 1000),
  opens_time text not null check (opens_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closes_time text not null check (closes_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_time < closes_time)
);

create table public.contest_entries (
  id bigint generated always as identity primary key,
  contest_id bigint not null references public.contests(id),
  number integer not null check (number between 1 and 999),
  name text not null check (char_length(name) between 1 and 60),
  team text not null default '' check (char_length(team) <= 60),
  theme text not null default '' check (char_length(theme) <= 100),
  created_at timestamptz not null default now(),
  unique (contest_id, number)
);

create table public.contest_votes (
  id bigint generated always as identity primary key,
  contest_id bigint not null references public.contests(id),
  device_id uuid not null,
  request_id uuid not null unique,
  first_id bigint not null references public.contest_entries(id),
  second_id bigint references public.contest_entries(id),
  third_id bigint references public.contest_entries(id),
  created_at timestamptz not null default now(),
  unique (contest_id, device_id)
);
create index contest_votes_first on public.contest_votes(first_id);
create index contest_votes_second on public.contest_votes(second_id);
create index contest_votes_third on public.contest_votes(third_id);

alter table public.contests enable row level security;
alter table public.contest_entries enable row level security;
alter table public.contest_votes enable row level security;
revoke all on public.contests, public.contest_entries, public.contest_votes from anon, authenticated;

insert into public.contests(label, description, opens_time, closes_time)
values ('仮装コンテスト', 'いちばん良かった仮装に投票してください。エントリー番号で1位・2位・3位を選びます。投票は1台のスマホで1回だけです。', '10:00', '15:00');

-- ---------- 内部の関数 ----------

create or replace function private.contest_status(c public.contests) returns text
language sql stable set search_path = '' as $$
  select case
    when now() < private.at(private.event_date(), c.opens_time) then 'before'
    when now() >= private.at(private.event_date(), c.closes_time) then 'closed'
    else 'open' end
$$;

create or replace function private.contest_json(c public.contests, p_admin boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d text := private.event_date(); entries jsonb; votes integer;
begin
  if p_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'number', x.number, 'name', x.name, 'team', x.team, 'theme', x.theme,
        'points', x.points, 'first', x.f, 'second', x.s, 'third', x.t, 'rank', x.rnk) order by x.number), '[]'::jsonb)
      into entries
      from (
        select y.*, y.f * 3 + y.s * 2 + y.t as points, rank() over (order by y.f * 3 + y.s * 2 + y.t desc, y.f desc) as rnk
        from (
          select e.id, e.number, e.name, e.team, e.theme,
            (select count(*) from public.contest_votes v where v.first_id = e.id)::integer as f,
            (select count(*) from public.contest_votes v where v.second_id = e.id)::integer as s,
            (select count(*) from public.contest_votes v where v.third_id = e.id)::integer as t
          from public.contest_entries e where e.contest_id = c.id
        ) y
      ) x;
    select count(*) into votes from public.contest_votes where contest_id = c.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('number', e.number, 'name', e.name, 'team', e.team, 'theme', e.theme) order by e.number), '[]'::jsonb)
      into entries from public.contest_entries e where e.contest_id = c.id;
  end if;
  return jsonb_build_object(
    'id', c.id, 'label', c.label, 'description', c.description,
    'opens_time', c.opens_time, 'closes_time', c.closes_time,
    'opens_at', private.iso(private.at(d, c.opens_time)), 'closes_at', private.iso(private.at(d, c.closes_time)),
    'status', private.contest_status(c), 'entries', entries)
    || case when p_admin then jsonb_build_object('votes', votes) else '{}'::jsonb end;
end $$;

create or replace function private.vote_json(v public.contest_votes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('contest_id', v.contest_id, 'created_at', private.iso(v.created_at),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('rank', p.rank, 'number', e.number, 'name', e.name) order by p.rank)
      from (values (1, v.first_id), (2, v.second_id), (3, v.third_id)) p(rank, entry_id)
      join public.contest_entries e on e.id = p.entry_id), '[]'::jsonb))
$$;

create or replace function private.contest_text(p jsonb, p_key text, p_max integer, p_label text, p_required boolean) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p ->> p_key, ''));
begin
  if p_required and v = '' then perform private.fail(format('%sを入力してください。', p_label), 'invalid'); end if;
  if char_length(v) > p_max then perform private.fail(format('%sは%s文字までです。', p_label, p_max), 'invalid'); end if;
  return v;
end $$;

-- ---------- 来場者向けの関数 ----------

-- p_device_id を渡すと、その端末の投票（my_vote）も返す。投票をリセットすると、また投票できる
create or replace function public.contest_state(p_device_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('now', private.iso(now()),
    'contests', coalesce((select jsonb_agg(private.contest_json(c, false)
        || jsonb_build_object('my_vote', (select private.vote_json(v) from public.contest_votes v where v.contest_id = c.id and v.device_id = p_device_id))
        order by c.id) from public.contests c), '[]'::jsonb))
$$;

-- p_numbers は [1位, 2位, 3位] のエントリー番号。出場者が3組未満なら、その数だけ
create or replace function public.cast_vote(p_contest_id bigint, p_numbers integer[], p_device_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.contests; existing public.contest_votes; created public.contest_votes;
  st text; need integer; ids bigint[] := '{}'; v_id bigint; n integer;
begin
  if p_device_id is null or p_request_id is null then
    perform private.fail('画面を再読み込みしてから、もう一度お試しください。', 'invalid');
  end if;
  select * into c from public.contests where id = p_contest_id for update;
  if not found then
    perform private.fail('このコンテストは見つかりません。画面を再読み込みしてください。', 'not_found');
  end if;
  select * into existing from public.contest_votes where request_id = p_request_id;
  if found then
    if existing.device_id <> p_device_id then
      perform private.fail('送信番号が重複しています。画面を再読み込みしてください。', 'request_conflict');
    end if;
    return jsonb_build_object('vote', private.vote_json(existing), 'replayed', true);
  end if;
  st := private.contest_status(c);
  if st = 'before' then perform private.fail(format('投票は %s から始まります。', c.opens_time), 'before'); end if;
  if st = 'closed' then perform private.fail('投票は終了しました。', 'closed'); end if;
  if exists (select 1 from public.contest_votes where contest_id = c.id and device_id = p_device_id) then
    perform private.fail('このスマホからは、すでに投票しています。投票は1回だけです。', 'voted');
  end if;
  select least(3, count(*)) into need from public.contest_entries where contest_id = c.id;
  if need = 0 then perform private.fail('出場者がまだ登録されていません。', 'invalid'); end if;
  if p_numbers is null or coalesce(cardinality(p_numbers), 0) <> need then
    perform private.fail(format('1位から%s位まで、すべて選んでください。', need), 'invalid');
  end if;
  if (select count(distinct x) from unnest(p_numbers) x) <> need then
    perform private.fail('同じ出場者を2回以上選ぶことはできません。', 'invalid');
  end if;
  foreach n in array p_numbers loop
    select id into v_id from public.contest_entries where contest_id = c.id and number = n;
    if not found then
      perform private.fail(format('エントリー番号 %s の出場者は見つかりません。画面を再読み込みしてください。', n), 'entries');
    end if;
    ids := ids || v_id;
  end loop;
  insert into public.contest_votes(contest_id, device_id, request_id, first_id, second_id, third_id)
  values (c.id, p_device_id, p_request_id, ids[1], ids[2], ids[3])
  returning * into created;
  return jsonb_build_object('vote', private.vote_json(created), 'replayed', false);
end $$;

-- ---------- 運営向けの関数 ----------

create or replace function public.admin_contest_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return jsonb_build_object('now', private.iso(now()), 'eventDate', private.event_date(),
    'contests', coalesce((select jsonb_agg(private.contest_json(c, true) order by c.id) from public.contests c), '[]'::jsonb));
end $$;

create or replace function public.admin_contest(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  action text := p ->> 'action'; v_id bigint; v_contest bigint; c public.contests; e public.contest_entries;
  v_label text; v_description text; v_opens text; v_closes text;
  v_number integer; v_name text; v_team text; v_theme text; removed integer;
begin
  perform private.require_staff();
  if jsonb_typeof(p) is distinct from 'object' then perform private.fail('操作を読み取れません。', 'invalid'); end if;
  v_id := case when p ? 'id' and (p ->> 'id') ~ '^[0-9]{1,18}$' then (p ->> 'id')::bigint end;

  if action in ('contest_create', 'contest_update') then
    v_label := private.contest_text(p, 'label', 40, 'コンテストの名前', true);
    v_description := private.contest_text(p, 'description', 1000, '説明', false);
    v_opens := coalesce(p ->> 'opensTime', ''); v_closes := coalesce(p ->> 'closesTime', '');
    if v_opens !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_closes !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      perform private.fail('時刻は「10:00」の形式で入力してください。', 'invalid');
    end if;
    if v_opens >= v_closes then perform private.fail('投票の終了は、開始より後の時刻にしてください。', 'invalid'); end if;
    if action = 'contest_create' then
      insert into public.contests(label, description, opens_time, closes_time) values (v_label, v_description, v_opens, v_closes) returning id into v_id;
    else
      update public.contests set label = v_label, description = v_description, opens_time = v_opens, closes_time = v_closes, updated_at = now() where id = v_id;
      if not found then perform private.fail('このコンテストは見つかりません。', 'not_found'); end if;
    end if;
    perform private.record(action, jsonb_build_object('id', v_id, 'label', v_label, 'opens', v_opens, 'closes', v_closes));
    return jsonb_build_object('id', v_id);
  end if;

  if action in ('contest_delete', 'contest_reset') then
    select * into c from public.contests where id = v_id for update;
    if not found then perform private.fail('このコンテストは見つかりません。', 'not_found'); end if;
    if action = 'contest_delete' then
      if exists (select 1 from public.contest_votes where contest_id = c.id) then
        perform private.fail('投票が入っているコンテストは削除できません。先に「投票をリセット」してください。', 'invalid');
      end if;
      delete from public.contest_entries where contest_id = c.id;
      delete from public.contests where id = c.id;
      perform private.record(action, jsonb_build_object('id', c.id, 'label', c.label));
      return jsonb_build_object('id', c.id);
    end if;
    delete from public.contest_votes where contest_id = c.id;
    get diagnostics removed = row_count;
    perform private.record(action, jsonb_build_object('id', c.id, 'label', c.label, 'removed', removed));
    return jsonb_build_object('id', c.id, 'removed', removed);
  end if;

  if action in ('entry_create', 'entry_update') then
    if action = 'entry_create' then
      v_contest := case when (p ->> 'contestId') ~ '^[0-9]{1,18}$' then (p ->> 'contestId')::bigint end;
      if not exists (select 1 from public.contests where id = v_contest) then perform private.fail('コンテストを選んでください。', 'invalid'); end if;
    else
      select * into e from public.contest_entries where id = v_id;
      if not found then perform private.fail('この出場者は見つかりません。', 'not_found'); end if;
      v_contest := e.contest_id;
    end if;
    if coalesce(p ->> 'number', '') !~ '^[0-9]{1,3}$' or (p ->> 'number')::integer < 1 then
      perform private.fail('エントリー番号は1〜999の数字で入力してください。', 'invalid');
    end if;
    v_number := (p ->> 'number')::integer;
    v_name := private.contest_text(p, 'name', 60, '名前', true);
    v_team := private.contest_text(p, 'team', 60, '学年と学科', false);
    v_theme := private.contest_text(p, 'theme', 100, 'テーマ', false);
    if exists (select 1 from public.contest_entries where contest_id = v_contest and number = v_number and id is distinct from v_id) then
      perform private.fail(format('エントリー番号 %s は、すでに使われています。', v_number), 'invalid');
    end if;
    if action = 'entry_create' then
      insert into public.contest_entries(contest_id, number, name, team, theme) values (v_contest, v_number, v_name, v_team, v_theme) returning id into v_id;
    else
      update public.contest_entries set number = v_number, name = v_name, team = v_team, theme = v_theme where id = v_id;
    end if;
    perform private.record(action, jsonb_build_object('id', v_id, 'contest', v_contest, 'number', v_number, 'name', v_name));
    return jsonb_build_object('id', v_id);
  end if;

  if action = 'entry_delete' then
    select * into e from public.contest_entries where id = v_id;
    if not found then perform private.fail('この出場者は見つかりません。', 'not_found'); end if;
    if exists (select 1 from public.contest_votes where first_id = e.id or second_id = e.id or third_id = e.id) then
      perform private.fail('投票が入っている出場者は削除できません。名前などの修正は、編集でできます。', 'invalid');
    end if;
    delete from public.contest_entries where id = e.id;
    perform private.record(action, jsonb_build_object('id', e.id, 'contest', e.contest_id, 'number', e.number, 'name', e.name));
    return jsonb_build_object('id', e.id);
  end if;

  perform private.fail('この操作には対応していません。', 'invalid');
  return null;
end $$;

-- ---------- 権限 ----------

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.contest_state(uuid), public.cast_vote(bigint, integer[], uuid, uuid),
  public.admin_contest_state(), public.admin_contest(jsonb) from public;
grant execute on function public.contest_state(uuid), public.cast_vote(bigint, integer[], uuid, uuid) to anon, authenticated;
grant execute on function public.admin_contest_state(), public.admin_contest(jsonb) to authenticated;
