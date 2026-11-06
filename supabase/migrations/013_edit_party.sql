-- 紅華祭 整理券アプリ Supabase版 DB定義 v13：スタッフが整理券の人数を直す
-- 012_no_login.sql を実行したあとに、SQL Editor に全文を貼り付けて実行します。
-- 申し込みで人数をまちがえたときに、運営画面から子どもの区分ごとの人数と保護者の人数を直せるようにする。
-- 直せるのは、有効で入場受付がまだの整理券だけ（回が終わったあとは直せない）。7桁の取消用パスワードが必要。
-- 1枚の上限人数・イベントの対象の区分・回の残りは、申し込むときと同じように守る。減らして空いた分はキャンセル待ちを繰り上げる。
-- 何度実行しても同じ結果になります。データは変更しません。

create or replace function private.tickets_cancel_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception '整理券の記録は削除できません。';
  end if;
  if new.id <> old.id or new.round_id <> old.round_id or new.number <> old.number
     or new.device_id <> old.device_id or new.request_id <> old.request_id or new.cancel_token <> old.cancel_token
     or new.created_at <> old.created_at or new.checkin_code <> old.checkin_code then
    raise exception '整理券は取消・受付・人数の修正以外の変更ができません。';
  end if;
  if new.party_size <> old.party_size or new.preschool <> old.preschool or new.elementary <> old.elementary
     or new.junior_high <> old.junior_high or new.high_school <> old.high_school or new.guardians <> old.guardians then
    if old.status = 'active' and new.status = 'active' and old.checked_in_at is null and new.checked_in_at is null
       and new.cancelled_at is null and new.cancelled_by is null
       and new.party_size = new.preschool + new.elementary + new.junior_high + new.high_school and new.party_size >= 1 then
      return new;
    end if;
    raise exception '整理券は取消・受付・人数の修正以外の変更ができません。';
  end if;
  if old.status = 'active' and new.status = 'cancelled' and old.checked_in_at is null and new.checked_in_at is null
     and new.cancelled_at is not null and new.cancelled_by is not null then
    return new;
  end if;
  if old.status = 'active' and new.status = 'cancelled' and old.checked_in_at is not null
     and new.checked_in_at = old.checked_in_at and new.cancelled_at is not null and new.cancelled_by = 'staff' then
    return new;
  end if;
  if old.status = 'active' and new.status = 'active' and old.checked_in_at is null and new.checked_in_at is not null
     and new.cancelled_at is null and new.cancelled_by is null then
    return new;
  end if;
  raise exception '整理券は取消・受付・人数の修正以外の変更ができません。';
end $$;

create or replace function public.admin_edit_party(p_id uuid, p_children jsonb, p_guardians integer, p_password text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets; r public.rounds; kids jsonb; total integer; remaining integer; d text := private.event_date();
begin
  perform private.require_staff();
  perform private.check_cancel_password(p_password);
  kids := private.party(p_children, p_guardians);
  total := (kids ->> 'total')::integer;
  select * into t from public.tickets where id = p_id;
  if not found then perform private.fail('整理券が見つかりません。', 'not_found'); end if;
  -- 回の行をロックし、同じ回の申し込み・取消と1件ずつ処理する
  select * into r from public.rounds where id = t.round_id for update;
  select * into t from public.tickets where id = p_id for update;
  if t.status <> 'active' then perform private.fail('この整理券は取り消されているため、人数を直せません。', 'cancelled'); end if;
  if t.checked_in_at is not null then perform private.fail('入場受付が済んだ整理券は、人数を直せません。', 'checked_in'); end if;
  if now() >= private.at(d, r.starts_time) + make_interval(mins => r.finish_after_minutes) then
    perform private.fail('この回は終了したため、人数を直せません。', 'finished');
  end if;
  if t.preschool = (kids ->> 'preschool')::integer and t.elementary = (kids ->> 'elementary')::integer
     and t.junior_high = (kids ->> 'junior_high')::integer and t.high_school = (kids ->> 'high_school')::integer
     and t.guardians = (kids ->> 'guardians')::integer then
    return jsonb_build_object('ticket', private.ticket_json(t, false, true), 'changed', false);
  end if;
  perform private.check_kinds(r, kids);
  if total > r.max_party then perform private.fail(format('1枚で申し込めるのは、子ども %s 名までです。', r.max_party), 'party'); end if;
  select greatest(0, r.capacity_people - coalesce(sum(x.party_size), 0)) into remaining
  from public.tickets x where x.round_id = r.id and x.status = 'active';
  if total - t.party_size > remaining then
    perform private.fail(format('この回の残りは子ども %s 名分なので、子ども %s 名にはできません。', remaining, total), 'remaining');
  end if;
  perform private.record('staff_edit', jsonb_build_object('ticket', t.id, 'round', r.id, 'number', t.number,
    'before', jsonb_build_object('preschool', t.preschool, 'elementary', t.elementary, 'junior_high', t.junior_high, 'high_school', t.high_school, 'guardians', t.guardians),
    'after', kids - 'total'));
  update public.tickets set party_size = total, preschool = (kids ->> 'preschool')::integer, elementary = (kids ->> 'elementary')::integer,
    junior_high = (kids ->> 'junior_high')::integer, high_school = (kids ->> 'high_school')::integer, guardians = (kids ->> 'guardians')::integer
  where id = p_id returning * into t;
  perform private.promote(r.id);
  return jsonb_build_object('ticket', private.ticket_json(t, false, true), 'changed', true);
end $$;

revoke execute on function public.admin_edit_party(uuid, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.admin_edit_party(uuid, jsonb, integer, text) to anon, authenticated;
