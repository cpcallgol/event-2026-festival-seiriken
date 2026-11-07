-- 紅華祭 整理券アプリ Supabase版 DB定義 v14：コンテストの調整点
-- 013_edit_party.sql を実行したあとに、SQL Editor に全文を貼り付けて実行します。
-- 出場者ごとに「調整点」（プラスでもマイナスでもよい）を入れられるようにする。7桁の取消用パスワードが必要。
-- 合計点 = 投票の点（1位=3点・2位=2点・3位=1点）+ 調整点。同点なら1位に選ばれた数が多い方が上。
-- これまでの投票と出場者はそのまま残ります（調整点は0から始まる）。何度実行しても同じ結果になります。

alter table public.contest_entries add column if not exists adjust integer not null default 0 check (adjust between -9999 and 9999);

create or replace function private.contest_json(c public.contests, p_admin boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d text := private.event_date(); entries jsonb; votes integer;
begin
  if p_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'number', x.number, 'name', x.name, 'team', x.team, 'theme', x.theme,
        'vote_points', x.vote_points, 'adjust', x.adjust, 'points', x.vote_points + x.adjust,
        'first', x.f, 'second', x.s, 'third', x.t, 'rank', x.rnk) order by x.number), '[]'::jsonb)
      into entries
      from (
        select y.*, y.f * 3 + y.s * 2 + y.t as vote_points,
          rank() over (order by y.f * 3 + y.s * 2 + y.t + y.adjust desc, y.f desc) as rnk
        from (
          select e.id, e.number, e.name, e.team, e.theme, e.adjust,
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

create or replace function public.admin_contest_adjust(p_entry_id bigint, p_adjust integer, p_password text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.contest_entries;
begin
  perform private.require_staff();
  perform private.check_cancel_password(p_password);
  if p_adjust is null or p_adjust < -9999 or p_adjust > 9999 then
    perform private.fail('調整点は -9999〜9999 の整数で入力してください。', 'invalid');
  end if;
  select * into e from public.contest_entries where id = p_entry_id for update;
  if not found then perform private.fail('この出場者は見つかりません。', 'not_found'); end if;
  if e.adjust = p_adjust then
    return jsonb_build_object('id', e.id, 'adjust', e.adjust, 'changed', false);
  end if;
  update public.contest_entries set adjust = p_adjust where id = e.id;
  perform private.record('contest_adjust', jsonb_build_object('id', e.id, 'contest', e.contest_id, 'number', e.number, 'name', e.name, 'before', e.adjust, 'after', p_adjust));
  return jsonb_build_object('id', e.id, 'adjust', p_adjust, 'changed', true);
end $$;

revoke execute on function private.contest_json(public.contests, boolean) from public, anon, authenticated;
revoke execute on function public.admin_contest_adjust(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.admin_contest_adjust(bigint, integer, text) to anon, authenticated;
