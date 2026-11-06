-- 紅華祭 整理券アプリ DB定義 v7：スタッフが整理券の人数を直す
-- 有効な整理券は、取消に加えて、人数（子どもの区分ごとの人数・保護者）だけを直せるようにする。

DROP TRIGGER tickets_cancel_only;
CREATE TRIGGER tickets_cancel_only BEFORE UPDATE ON tickets
BEGIN
  SELECT CASE WHEN
    OLD.status <> 'active'
    OR NEW.id <> OLD.id OR NEW.round_id <> OLD.round_id OR NEW.number <> OLD.number
    OR NEW.device_id <> OLD.device_id OR NEW.request_id <> OLD.request_id OR NEW.cancel_token <> OLD.cancel_token
    OR NEW.created_at <> OLD.created_at OR NEW.name <> ''
    OR NOT (
      (NEW.status = 'cancelled'
        AND NEW.party_size = OLD.party_size AND NEW.preschool = OLD.preschool AND NEW.elementary = OLD.elementary
        AND NEW.junior_high = OLD.junior_high AND NEW.high_school = OLD.high_school AND NEW.guardians = OLD.guardians
        AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL)
      OR (NEW.status = 'active' AND NEW.cancelled_at IS NULL AND NEW.cancelled_by IS NULL
        AND NEW.party_size >= 1 AND NEW.party_size = NEW.preschool + NEW.elementary + NEW.junior_high + NEW.high_school)
    )
  THEN RAISE(ABORT, '整理券は取消と人数の修正以外の変更ができません。') END;
END;
