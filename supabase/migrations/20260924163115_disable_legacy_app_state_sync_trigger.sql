-- The legacy compatibility trigger compared the full 10k+ transaction arrays
-- on every old-client app_state PATCH and caused statement timeouts.
-- New clients persist transaction deltas through save_app_state_v2/v3 instead.

drop trigger if exists trg_sync_legacy_app_state_transactions on public.app_state;
drop function if exists public.sync_legacy_app_state_transactions();
